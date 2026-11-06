import { app } from 'electron';
import type { ApiRequest, ApiResponse, PublicSettings } from '../shared/types';
import { DEFAULT_DOMAIN, looksLocal, type Store } from './store';

export const CLIENT_NAME = 'DarkTalkDesktop';

export function userAgent(): string {
  return `${CLIENT_NAME}/${app.getVersion()} (Windows; Electron)`;
}

export function httpBase(store: Store): string {
  const raw = store.serverDomain.trim();
  const lower = raw.toLowerCase();
  const scheme =
    lower.startsWith('http://') || lower.startsWith('ws://')
      ? 'http'
      : lower.startsWith('https://') || lower.startsWith('wss://')
        ? 'https'
        : looksLocal(lower)
          ? 'http'
          : store.useSsl
            ? 'https'
            : 'http';
  const clean = raw.replace(/^(https?|wss?):\/\//i, '').replace(/^\/+|\/+$/g, '').trim();
  const hostPort = clean || DEFAULT_DOMAIN;
  try {
    return new URL(`${scheme}://${hostPort}/`).toString();
  } catch {
    return `https://${DEFAULT_DOMAIN}/`;
  }
}

export function wsBase(store: Store): string {
  const u = new URL(httpBase(store));
  return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`;
}

export function resolveUrl(store: Store, url: string | null | undefined): string | null {
  if (!url || !url.trim()) return null;
  const t = url.trim();
  if (/^https?:\/\//i.test(t)) return t;
  const base = httpBase(store).replace(/\/$/, '');
  return base + (t.startsWith('/') ? t : `/${t}`);
}

export function isOurHost(store: Store, urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const ours = new URL(httpBase(store));
    return u.host === ours.host || u.hostname === DEFAULT_DOMAIN;
  } catch {
    return false;
  }
}

/** The token is sent ONLY to our own server (never to CDN / third-party hosts). */
export function addAuthHeaders(store: Store, headers: Headers, targetUrl: string): void {
  if (!isOurHost(store, targetUrl)) return;
  const token = store.token;
  if (token) headers.set('Authorization', `Token ${token}`);
}

export async function apiRequest(
  store: Store,
  req: ApiRequest,
  onUnauthorized: () => void,
): Promise<ApiResponse> {
  const url = new URL(req.path.replace(/^\/+/, ''), httpBase(store));
  if (req.query) {
    for (const [k, v] of Object.entries(req.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers = new Headers({ Accept: 'application/json', 'User-Agent': userAgent() });
  addAuthHeaders(store, headers, url.toString());

  let body: BodyInit | undefined;
  if (req.form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(req.form.fields)) {
      if (v !== undefined && v !== null) fd.append(k, v);
    }
    const f = req.form.file;
    if (f) fd.append(f.field, new Blob([f.bytes as BlobPart], { type: f.mime }), f.name);
    body = fd;
  } else if (req.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(req.json);
  }

  const hadToken = !!store.token;
  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(req.timeoutMs ?? (req.form?.file ? 180_000 : 30_000)),
    });
    const raw = await res.text();
    let data: unknown = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }
    // Token revoked / device removed -> sign out (but not for the auth endpoints themselves).
    if (res.status === 401 && hadToken && !url.pathname.includes('/auth/')) onUnauthorized();
    return { status: res.status, ok: res.ok, data, raw };
  } catch (e) {
    const err = e as Error;
    const msg = err.name === 'TimeoutError' ? 'Request timed out' : (err.cause as Error | undefined)?.message || err.message;
    return { status: 0, ok: false, data: null, networkError: msg || 'Network error' };
  }
}

export function toPublic(store: Store): PublicSettings {
  return {
    serverDomain: store.serverDomain,
    useSsl: store.useSsl,
    deviceId: store.deviceId,
    userId: store.userId,
    username: store.username,
    userLanguage: store.userLanguage,
    appTheme: store.appTheme,
    reactionEmojis: store.reactionEmojis,
    mediaCacheLimitMb: store.mediaCacheLimitMb,
    isLoggedIn: !!store.token,
    httpBase: httpBase(store),
    version: app.getVersion(),
  };
}
