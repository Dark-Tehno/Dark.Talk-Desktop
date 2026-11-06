import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Chat, Message, User, WsEventMsg } from '../shared/types';

/** Newest messages kept per chat (same as the Android client). */
export const KEEP_MESSAGES = 50;
/** Files bigger than this are streamed from the server and not kept on disk. */
const MAX_MEDIA_FILE = 64 * 1024 * 1024;

interface Snapshot {
  version: 1;
  userId: number;
  me: User | null;
  chats: Chat[];
  messages: Record<string, Message[]>;
}

const empty = (userId: number): Snapshot => ({ version: 1, userId, me: null, chats: [], messages: {} });

/**
 * Offline storage (port of the Android Room cache): own profile, the chat list with last messages and the newest
 * messages of every chat. A single JSON file in the app profile, written atomically and debounced.
 * The data belongs to one account – it is dropped when somebody else signs in or the user signs out.
 */
export class DataCache {
  private file = path.join(app.getPath('userData'), 'data-cache.json');
  private data: Snapshot = empty(-1);
  private timer: NodeJS.Timeout | null = null;

  constructor(private currentUserId: () => number) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Snapshot;
      if (raw && raw.version === 1 && raw.messages && Array.isArray(raw.chats)) this.data = raw;
    } catch {
      /* first start or a damaged file: start empty */
    }
  }

  /** Returns the snapshot for the signed-in user (resets it when the account changed). */
  private d(): Snapshot {
    const uid = this.currentUserId();
    if (this.data.userId !== uid) {
      this.data = empty(uid);
      this.schedule();
    }
    return this.data;
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 600);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(this.data), 'utf8');
      await fsp.rename(tmp, this.file);
    } catch (e) {
      console.error('cache write failed', e);
    }
  }

  flushSync(): void {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data), 'utf8');
    } catch {
      /* best effort on exit */
    }
  }

  // ---- profile / chats

  getMe(): User | null {
    return this.d().me;
  }

  setMe(me: User | null): void {
    this.d().me = me;
    this.schedule();
  }

  getChats(): Chat[] {
    return this.d().chats;
  }

  setChats(chats: Chat[]): void {
    const d = this.d();
    d.chats = chats;
    const ids = new Set(chats.map((c) => String(c.id)));
    for (const k of Object.keys(d.messages)) if (!ids.has(k)) delete d.messages[k];
    this.schedule();
  }

  // ---- messages

  getMessages(chatId: number): Message[] {
    return this.d().messages[String(chatId)] ?? [];
  }

  /** Replaces the stored window with the newest KEEP_MESSAGES of `list`. */
  setMessages(chatId: number, list: Message[]): void {
    const sorted = [...list].sort((a, b) => a.id - b.id);
    this.d().messages[String(chatId)] = sorted.slice(-KEEP_MESSAGES);
    this.schedule();
  }

  private upsert(m: Message): void {
    const d = this.d();
    const key = String(m.chat_id);
    const list = d.messages[key] ?? [];
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) list[i] = m;
    else list.push(m);
    list.sort((a, b) => a.id - b.id);
    d.messages[key] = list.slice(-KEEP_MESSAGES);
  }

  /** Keeps the cache of every chat current from the live socket events, whether or not the chat is open. */
  applyEvent(ev: WsEventMsg): void {
    const d = this.d();
    switch (ev.type) {
      case 'message_created':
      case 'message_updated': {
        const m = ev.message as Message | undefined;
        if (!m || m.chat_id == null || m.is_deleted) {
          if (m && m.is_deleted) this.removeMessage(m.chat_id, m.id);
          return;
        }
        this.upsert(m);
        break;
      }
      case 'message_deleted':
        this.removeMessage(Number(ev.chat_id), Number(ev.message_id));
        return;
      case 'message_read': {
        const list = d.messages[String(ev.chat_id)];
        if (!list) return;
        const uid = Number(ev.user_id);
        for (const m of list) if (m.id <= Number(ev.message_id) && !(m.read_by ?? []).includes(uid)) m.read_by = [...(m.read_by ?? []), uid];
        break;
      }
      case 'chat_deleted':
        delete d.messages[String(ev.chat_id)];
        d.chats = d.chats.filter((c) => c.id !== Number(ev.chat_id));
        break;
      default:
        return;
    }
    this.schedule();
  }

  private removeMessage(chatId: number, messageId: number): void {
    const d = this.d();
    const key = String(chatId);
    if (d.messages[key]) d.messages[key] = d.messages[key].filter((x) => x.id !== messageId);
    this.schedule();
  }

  // ---- housekeeping

  clear(): void {
    this.data = empty(this.currentUserId());
    this.schedule();
  }

  sizeBytes(): number {
    try {
      return fs.statSync(this.file).size;
    } catch {
      return 0;
    }
  }
}

/** On-disk cache of downloaded media (photos, voice, files) with LRU eviction by a size limit. */
export class MediaCache {
  private dir = path.join(app.getPath('userData'), 'media-cache');
  readonly maxFile = MAX_MEDIA_FILE;

  constructor(private limitBytes: () => number) {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  key(url: string): string {
    return crypto.createHash('sha1').update(url).digest('hex');
  }

  private p(key: string): string {
    return path.join(this.dir, key);
  }

  async lookup(key: string): Promise<{ file: string; size: number; type: string } | null> {
    try {
      const st = await fsp.stat(this.p(key));
      const type = await fsp.readFile(`${this.p(key)}.type`, 'utf8').catch(() => 'application/octet-stream');
      const now = new Date();
      void fsp.utimes(this.p(key), now, now).catch(() => {}); // touch: most recently used
      return { file: this.p(key), size: st.size, type: type.trim() || 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  async store(key: string, data: Buffer, type: string, url?: string): Promise<void> {
    try {
      const tmp = `${this.p(key)}.part`;
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, this.p(key));
      await fsp.writeFile(`${this.p(key)}.type`, type, 'utf8');
      if (url) await fsp.writeFile(`${this.p(key)}.url`, url, 'utf8');
      void this.evict();
    } catch {
      /* the cache is an optimisation only */
    }
  }

  async size(): Promise<number> {
    let total = 0;
    for (const name of await fsp.readdir(this.dir).catch(() => [])) {
      if (name.endsWith('.type') || name.endsWith('.part')) continue;
      total += (await fsp.stat(path.join(this.dir, name)).catch(() => null))?.size ?? 0;
    }
    return total;
  }

  async evict(): Promise<void> {
    const limit = this.limitBytes();
    if (limit <= 0) return;
    const items: { name: string; size: number; at: number }[] = [];
    for (const name of await fsp.readdir(this.dir).catch(() => [])) {
      if (name.endsWith('.type') || name.endsWith('.part')) continue;
      const st = await fsp.stat(path.join(this.dir, name)).catch(() => null);
      if (st) items.push({ name, size: st.size, at: st.mtimeMs });
    }
    let total = items.reduce((a, b) => a + b.size, 0);
    items.sort((a, b) => a.at - b.at);
    for (const it of items) {
      if (total <= limit) break;
      await fsp.rm(path.join(this.dir, it.name), { force: true });
      await fsp.rm(path.join(this.dir, `${it.name}.type`), { force: true });
      await fsp.rm(path.join(this.dir, `${it.name}.url`), { force: true });
      total -= it.size;
    }
  }

  async clear(): Promise<void> {
    await fsp.rm(this.dir, { recursive: true, force: true });
    await fsp.mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<Array<{ key: string; size: number; type: string; url: string; accessed: number }>> {
    const items: Array<{ key: string; size: number; type: string; url: string; accessed: number }> = [];
    for (const name of await fsp.readdir(this.dir).catch(() => [])) {
      if (name.endsWith('.type') || name.endsWith('.part')) continue;
      const st = await fsp.stat(path.join(this.dir, name)).catch(() => null);
      if (!st) continue;
      const type = await fsp.readFile(path.join(this.dir, `${name}.type`), 'utf8').catch(() => 'application/octet-stream');
      const urlFile = path.join(this.dir, `${name}.url`);
      const url = await fsp.readFile(urlFile, 'utf8').catch(() => '');
      items.push({ key: name, size: st.size, type: type.trim() || 'application/octet-stream', url, accessed: st.mtimeMs });
    }
    items.sort((a, b) => b.accessed - a.accessed);
    return items;
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      await fsp.rm(this.p(key), { force: true });
      await fsp.rm(`${this.p(key)}.type`, { force: true });
      await fsp.rm(`${this.p(key)}.url`, { force: true });
    }
  }
}
