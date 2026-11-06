import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, powerMonitor, protocol, session, shell } from 'electron';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { ApiRequest, SessionInfo, SettingsPatch } from '../shared/types';
import { addAuthHeaders, apiRequest, resolveUrl, toPublic, userAgent } from './net';
import { DataCache, MediaCache } from './cache';
import { Store } from './store';
import { WsManager } from './ws';

// Must run before app is ready. dtmedia://m/?u=<url> lets <img>/<audio>/<video> load
// authenticated media: the main process adds the token and streams the bytes.
protocol.registerSchemesAsPrivileged([
  { scheme: 'dtmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

let win: BrowserWindow | null = null;
let store: Store;
let ws: WsManager;
let cache: DataCache;
let media: MediaCache;
let pendingScreenId: string | null = null;

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#070B14',
    title: 'Dark.Talk',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // Links never navigate the app window – they open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start = m[1] ? Number(m[1]) : size - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  return start <= end ? { start, end } : null;
}

function serveCached(file: string, size: number, type: string, rangeHeader: string | null): Response {
  const range = parseRange(rangeHeader, size);
  const headers = new Headers({ 'content-type': type, 'accept-ranges': 'bytes' });
  if (!range) {
    headers.set('content-length', String(size));
    return new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, { status: 200, headers });
  }
  headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('content-length', String(range.end - range.start + 1));
  return new Response(Readable.toWeb(createReadStream(file, { start: range.start, end: range.end })) as unknown as ReadableStream, { status: 206, headers });
}

function registerMediaProtocol(): void {
  protocol.handle('dtmedia', async (req) => {
    // dtmedia://k/?key=<sha1> serves an already cached file by key (used by the cache manager preview).
    const cacheKey = new URL(req.url).searchParams.get('key');
    if (cacheKey) {
      if (!/^[0-9a-f]{40}$/.test(cacheKey)) return new Response('Bad key', { status: 400 });
      const cached = await media.lookup(cacheKey);
      return cached ? serveCached(cached.file, cached.size, cached.type, req.headers.get('range')) : new Response('Not found', { status: 404 });
    }
    const raw = new URL(req.url).searchParams.get('u');
    const target = raw ? resolveUrl(store, raw) : null;
    if (!target || !/^https?:\/\//i.test(target)) return new Response('Bad media url', { status: 400 });

    const range = req.headers.get('range');
    const key = media.key(target);

    // Offline-first: anything downloaded once is served from disk (also with the server unreachable).
    const hit = await media.lookup(key);
    if (hit) return serveCached(hit.file, hit.size, hit.type, range);

    const headers = new Headers({ 'User-Agent': userAgent() });
    addAuthHeaders(store, headers, target);
    try {
      const upstream = await fetch(target, { headers });
      const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
      const length = Number(upstream.headers.get('content-length') ?? 0);
      if (!upstream.ok || !upstream.body || length > media.maxFile) {
        const out = new Headers();
        for (const h of ['content-type', 'content-length', 'cache-control']) {
          const v = upstream.headers.get(h);
          if (v) out.set(h, v);
        }
        return new Response(upstream.body, { status: upstream.status, headers: out });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      await media.store(key, buf, type, target);
      const stored = await media.lookup(key);
      if (stored) return serveCached(stored.file, stored.size, stored.type, range);
      return new Response(buf, { status: 200, headers: { 'content-type': type } });
    } catch {
      return new Response('Offline', { status: 502 });
    }
  });
}

function registerIpc(): void {
  const wipeLocalData = (): void => {
    cache.clear();
    void media.clear();
  };
  const handleUnauthorized = (): void => {
    wipeLocalData();
    store.clearAuth();
    ws.disconnectAll();
    send('auth:cleared');
  };

  ipcMain.handle('settings:get', () => toPublic(store));

  ipcMain.handle('settings:set', (_e, patch: SettingsPatch) => {
    const before = `${store.serverDomain}|${store.useSsl}`;
    const limitBefore = store.mediaCacheLimitMb;
    const domainBefore = store.serverDomain;
    store.patch(patch);
    if (limitBefore !== store.mediaCacheLimitMb) void media.evict();
    if (domainBefore !== store.serverDomain) {
      // another server = other accounts and chats: never mix their data
      cache.clear();
      void media.clear();
    }
    const after = `${store.serverDomain}|${store.useSsl}`;
    if (before !== after && store.token) {
      ws.disconnectAll();
      ws.connectChats();
    }
    return toPublic(store);
  });

  ipcMain.handle('auth:setSession', (_e, s: SessionInfo) => {
    store.setSession(s);
    ws.connectChats();
    return toPublic(store);
  });

  ipcMain.handle('auth:clear', () => {
    wipeLocalData();
    ws.disconnectAll();
    store.clearAuth();
    return toPublic(store);
  });

  ipcMain.handle('api:request', (_e, req: ApiRequest) => apiRequest(store, req, handleUnauthorized));

  ipcMain.handle('ws:connectChats', () => ws.connectChats());
  ipcMain.handle('ws:enterRoom', (_e, chatId: number) => ws.enterRoom(chatId));
  ipcMain.handle('ws:leaveRoom', () => ws.leaveRoom());
  ipcMain.handle('ws:disconnect', () => ws.disconnectAll());
  ipcMain.handle('ws:reconnect', () => ws.reconnectAll());
  ipcMain.handle('ws:send', (_e, payload: unknown) => ws.send(payload));
  ipcMain.handle('ws:sendCall', (_e, payload: unknown) => ws.send(payload, 'chats'));

  // Screen sharing: the renderer shows its own picker, then getDisplayMedia() is answered with the chosen source.
  ipcMain.handle('screen:sources', async () => {
    const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
    return list.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL(), isScreen: s.id.startsWith('screen:') }));
  });
  ipcMain.handle('screen:select', (_e, id: string | null) => {
    pendingScreenId = id;
  });

  ipcMain.handle('file:save', async (_e, url: string, name: string) => {
    try {
      const target = resolveUrl(store, url);
      if (!target || !/^https?:\/\//i.test(target)) return { ok: false, error: 'Bad url' };
      const safeName = path.basename(name || 'file').replace(/[<>:"/\\|?*]/g, '_') || 'file';
      const pick = await dialog.showSaveDialog(win ?? undefined!, { defaultPath: safeName });
      if (pick.canceled || !pick.filePath) return { ok: false, error: 'cancelled' };
      const headers = new Headers({ 'User-Agent': userAgent() });
      addAuthHeaders(store, headers, target);
      const res = await fetch(target, { headers });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      await fs.writeFile(pick.filePath, Buffer.from(await res.arrayBuffer()));
      return { ok: true, path: pick.filePath };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // ---- offline storage (renderer reads it first, then refreshes from the server)
  ipcMain.handle('cache:me', () => cache.getMe());
  ipcMain.handle('cache:setMe', (_e, u) => cache.setMe(u));
  ipcMain.handle('cache:chats', () => cache.getChats());
  ipcMain.handle('cache:saveChats', (_e, chats) => cache.setChats(chats));
  ipcMain.handle('cache:messages', (_e, chatId: number) => cache.getMessages(chatId));
  ipcMain.handle('cache:saveMessages', (_e, chatId: number, list) => cache.setMessages(chatId, list));
  ipcMain.handle('cache:sizes', async () => ({ data: cache.sizeBytes(), media: await media.size() }));
  ipcMain.handle('cache:clearData', () => cache.clear());
  ipcMain.handle('cache:clearMedia', async () => {
    await media.clear();
    await session.defaultSession.clearCache();
  });
  ipcMain.handle('cache:listMedia', async () => await media.list());
  ipcMain.handle('cache:deleteMedia', async (_e, keys: string[]) => await media.delete(keys));

  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('com.darktehno.darktalk.desktop');

    store = new Store();
    cache = new DataCache(() => store.userId);
    media = new MediaCache(() => store.mediaCacheLimitMb * 1024 * 1024);
    ws = new WsManager(store, send, (ev) => cache.applyEvent(ev));

    // Microphone / camera (calls, voice messages), screen capture and notifications – only for our own UI.
    const allowed = new Set(['media', 'display-capture', 'notifications']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

    session.defaultSession.setDisplayMediaRequestHandler(
      async (_req, callback) => {
        const id = pendingScreenId;
        pendingScreenId = null;
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
          const src = sources.find((s) => s.id === id);
          if (!src) return callback({});
          callback({ video: src });
        } catch {
          callback({});
        }
      },
      { useSystemPicker: false },
    );

    powerMonitor.on('resume', () => setTimeout(() => ws.reconnectAll(), 2000));

    registerMediaProtocol();
    registerIpc();
    createWindow();
    if (store.token) ws.connectChats();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => cache?.flushSync());

  app.on('window-all-closed', () => {
    ws?.disconnectAll();
    if (process.platform !== 'darwin') app.quit();
  });
}
