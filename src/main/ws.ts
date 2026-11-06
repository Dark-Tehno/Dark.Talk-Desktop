import WebSocket from 'ws';
import type { WsEventMsg, WsScope, WsState } from '../shared/types';
import { httpBase, userAgent, wsBase } from './net';
import type { Store } from './store';

interface Slot {
  ws: WebSocket | null;
  gen: number;
  reconnect: NodeJS.Timeout | null;
  ping: NodeJS.Timeout | null;
  lastSeen: number;
}

type Emit = (channel: string, payload: unknown) => void;

/**
 * Two sockets, same as the Android client:
 *  - /ws/chats/        – events of all the user's chats + Dark.Call signaling
 *  - /ws/chat/{id}/    – the opened room (adds typing events, used for sending)
 * Auth header (Authorization: Token ...) is sent in the HTTP upgrade request.
 */
export class WsManager {
  private slots: Record<WsScope, Slot> = {
    chats: { ws: null, gen: 0, reconnect: null, ping: null, lastSeen: 0 },
    room: { ws: null, gen: 0, reconnect: null, ping: null, lastSeen: 0 },
  };
  private roomId: number | null = null;
  // The same event arrives through both sockets – drop duplicates for a few seconds.
  private seen = new Map<string, number>();

  constructor(
    private store: Store,
    private emit: Emit,
    /** Called with every (deduplicated) event, e.g. to keep the offline cache current. */
    private tap?: (ev: WsEventMsg) => void,
  ) {}

  private setState(scope: WsScope, state: WsState): void {
    this.emit('ws:state', { scope, state });
  }

  private isDuplicate(key: string): boolean {
    const now = Date.now();
    for (const [k, t] of this.seen) {
      if (now - t > 4000) this.seen.delete(k);
      else break;
    }
    if (this.seen.has(key)) return true;
    this.seen.set(key, now);
    return false;
  }

  private shouldRetry(httpCode: number | undefined, closeCode: number): boolean {
    if (httpCode === 401 || httpCode === 403) return false;
    if (closeCode === 1000 || closeCode === 4001 || closeCode === 4003) return false;
    return !!this.store.token;
  }

  private open(scope: WsScope): void {
    const slot = this.slots[scope];
    if (slot.ws) return;
    const p = scope === 'chats' ? '/ws/chats/' : this.roomId != null ? `/ws/chat/${this.roomId}/` : null;
    const token = this.store.token;
    if (!p || !token) return;

    const gen = ++slot.gen;
    this.setState(scope, 'connecting');
    const ws = new WebSocket(wsBase(this.store) + p, {
      handshakeTimeout: 15_000,
      headers: {
        Authorization: `Token ${token}`,
        Origin: httpBase(this.store).replace(/\/$/, ''),
        'User-Agent': userAgent(),
      },
    });
    slot.ws = ws;
    let httpCode: number | undefined;
    const stale = (): boolean => gen !== slot.gen;

    ws.on('open', () => {
      if (stale()) {
        ws.close();
        return;
      }
      this.setState(scope, 'connected');
      slot.lastSeen = Date.now();
      // Heartbeat with a dead-socket detector: a connection that silently died (sleep, Wi-Fi switch, heavy
      // traffic during a call) never emits 'close', so no new messages would arrive. No pong -> reconnect.
      slot.ping = setInterval(() => {
        if (Date.now() - slot.lastSeen > 40_000) {
          ws.terminate();
          return;
        }
        try {
          ws.ping();
        } catch {
          /* socket is closing */
        }
      }, 12_000);
    });
    ws.on('pong', () => {
      slot.lastSeen = Date.now();
    });
    ws.on('message', (data) => {
      if (stale()) return;
      slot.lastSeen = Date.now();
      this.handle(data.toString());
    });
    ws.on('unexpected-response', (_req, res) => {
      httpCode = res.statusCode;
      ws.terminate();
    });
    ws.on('error', () => {
      /* reported through 'close' */
    });
    ws.on('close', (code) => {
      if (slot.ping) {
        clearInterval(slot.ping);
        slot.ping = null;
      }
      if (stale()) return;
      slot.ws = null;
      this.setState(scope, httpCode !== undefined || code !== 1000 ? 'error' : 'disconnected');
      if (this.shouldRetry(httpCode, code)) this.schedule(scope);
    });
  }

  private schedule(scope: WsScope): void {
    const slot = this.slots[scope];
    if (slot.reconnect) clearTimeout(slot.reconnect);
    slot.reconnect = setTimeout(
      () => {
        slot.reconnect = null;
        if (!this.store.token || slot.ws) return;
        if (scope === 'room' && this.roomId == null) return;
        this.open(scope);
      },
      scope === 'chats' ? 5000 : 3000,
    );
  }

  private close(scope: WsScope, reason: string): void {
    const slot = this.slots[scope];
    slot.gen++; // invalidates callbacks of the old socket
    if (slot.reconnect) clearTimeout(slot.reconnect);
    slot.reconnect = null;
    if (slot.ping) clearInterval(slot.ping);
    slot.ping = null;
    try {
      slot.ws?.close(1000, reason);
    } catch {
      slot.ws?.terminate();
    }
    slot.ws = null;
    this.setState(scope, 'disconnected');
  }

  connectChats(): void {
    this.open('chats');
  }

  enterRoom(chatId: number): void {
    if (this.roomId === chatId && this.slots.room.ws) return;
    this.close('room', 'switching room');
    this.roomId = chatId;
    this.open('room');
  }

  leaveRoom(): void {
    this.roomId = null;
    this.close('room', 'leaving room');
  }

  /** Drops and reopens both sockets (network came back / system woke up). */
  reconnectAll(): void {
    if (!this.store.token) return;
    this.close('chats', 'reconnect');
    this.open('chats');
    if (this.roomId != null) {
      this.close('room', 'reconnect');
      this.open('room');
    }
  }

  disconnectAll(): void {
    this.close('chats', 'logout');
    this.leaveRoom();
  }

  send(payload: unknown, scope: WsScope = 'room'): boolean {
    const ws = this.slots[scope].ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private handle(text: string): void {
    let ev: Record<string, any>;
    try {
      ev = JSON.parse(text);
    } catch {
      return;
    }
    if (!ev || typeof ev.type !== 'string') return;
    const msg = ev.message as Record<string, any> | undefined;
    let key: string | null = null;
    switch (ev.type) {
      case 'chat_created':
        key = `n:${ev.chat_id ?? ev.chat?.id}`;
        break;
      case 'message_created':
        key = `c:${msg?.id}`;
        break;
      case 'message_updated':
        key = `u:${msg?.id}:${msg?.updated_at}:${msg?.text}:${((msg?.reactions as { id?: number; emoji?: string; user_id?: number }[] | undefined) ?? []).map((r) => `${r.user_id}${r.emoji}`).join(',')}`;
        break;
      case 'message_deleted':
        key = `d:${ev.message_id}`;
        break;
      case 'message_read':
        key = `r:${ev.chat_id}:${ev.message_id}:${ev.user_id}`;
        break;
      default:
        break;
    }
    if (key && this.isDuplicate(key)) return;
    try {
      this.tap?.(ev as WsEventMsg);
    } catch (e) {
      console.error('event tap failed', e);
    }
    this.emit('ws:event', ev);
  }
}
