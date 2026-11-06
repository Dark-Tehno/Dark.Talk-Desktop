import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SessionInfo, SettingsPatch } from '../shared/types';

export interface Persisted {
  serverDomain?: string;
  useSsl?: boolean;
  deviceId?: string;
  tokenEnc?: string; // base64, encrypted with OS keychain (DPAPI on Windows)
  tokenPlain?: string; // fallback when encryption is unavailable
  userId?: number;
  username?: string | null;
  userLanguage?: string;
  appTheme?: string;
  reactionEmojis?: string;
  mediaCacheLimitMb?: number;
}

export const DEFAULT_DOMAIN = 'vsp210.ru';
export const DEFAULT_EMOJIS = '❤️,🔥,👍,😂,😮,👏';
const LOCAL_MARKERS = [':8000', ':8080', ':5000', ':3000', '10.0.2.2', 'localhost', '127.0.0.1'];

export function looksLocal(domain: string): boolean {
  const l = domain.trim().toLowerCase();
  return LOCAL_MARKERS.some((m) => l.includes(m));
}

export class Store {
  private file: string;
  private data: Persisted = {};

  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Persisted;
    } catch {
      this.data = {};
    }
    if (!this.data.deviceId) {
      this.data.deviceId = `windows-${crypto.randomUUID().slice(0, 8)}`;
      this.flush();
    }
  }

  private flush(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('settings write failed', e);
    }
  }

  get serverDomain(): string {
    return this.data.serverDomain?.trim() || DEFAULT_DOMAIN;
  }
  get useSsl(): boolean {
    if (looksLocal(this.serverDomain)) return false;
    return this.data.useSsl ?? true;
  }
  get deviceId(): string {
    return this.data.deviceId as string;
  }
  get userId(): number {
    return this.data.userId ?? -1;
  }
  get username(): string | null {
    return this.data.username ?? null;
  }
  get userLanguage(): string {
    return this.data.userLanguage || 'Russian';
  }
  get appTheme(): string {
    return this.data.appTheme || 'telegram';
  }
  get reactionEmojis(): string {
    return this.data.reactionEmojis || DEFAULT_EMOJIS;
  }

  /** 0 = unlimited */
  get mediaCacheLimitMb(): number {
    return this.data.mediaCacheLimitMb ?? 500;
  }

  get token(): string | null {
    try {
      if (this.data.tokenEnc && safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(this.data.tokenEnc, 'base64'));
      }
    } catch {
      /* fall through */
    }
    return this.data.tokenPlain || null;
  }

  patch(p: SettingsPatch): void {
    if (p.serverDomain !== undefined) {
      const d = p.serverDomain.trim();
      this.data.serverDomain = d;
      const l = d.toLowerCase();
      if (l.startsWith('http://') || l.startsWith('ws://') || looksLocal(l)) this.data.useSsl = false;
      else if (l.startsWith('https://') || l.startsWith('wss://')) this.data.useSsl = true;
    }
    if (p.useSsl !== undefined) this.data.useSsl = p.useSsl;
    if (p.deviceId !== undefined && p.deviceId.trim()) this.data.deviceId = p.deviceId.trim();
    if (p.userLanguage !== undefined) this.data.userLanguage = p.userLanguage.trim();
    if (p.appTheme !== undefined) this.data.appTheme = p.appTheme.trim();
    if (p.mediaCacheLimitMb !== undefined) this.data.mediaCacheLimitMb = Math.max(0, Math.floor(p.mediaCacheLimitMb));
    if (p.reactionEmojis !== undefined) this.data.reactionEmojis = p.reactionEmojis.trim() || DEFAULT_EMOJIS;
    this.flush();
  }

  setSession(s: SessionInfo): void {
    delete this.data.tokenEnc;
    delete this.data.tokenPlain;
    if (safeStorage.isEncryptionAvailable()) {
      this.data.tokenEnc = safeStorage.encryptString(s.token).toString('base64');
    } else {
      this.data.tokenPlain = s.token;
    }
    this.data.userId = s.userId;
    this.data.username = s.username;
    if (s.language) this.data.userLanguage = s.language;
    this.flush();
  }

  clearAuth(): void {
    delete this.data.tokenEnc;
    delete this.data.tokenPlain;
    delete this.data.userId;
    delete this.data.username;
    this.flush();
  }
}
