import type { Chat, Message, Reaction, User, WsEventMsg, WsState } from '../shared/types';
import * as api from './api';
import { openAddParticipantsDialog, openChatInfo } from './dialogs';
import { S, myId, nav } from './state';
import { avatar, confirmDialog, contextMenu, h, icon, mediaSrc, nameColor, openModal, readFileBytes, toast, type MenuItem } from './ui';
import { linkify } from './ui';
import { call, groupCalls, joinGroupCall, startCallFromChat, startGroupCallFromChat } from './call';
import { attachmentKind, describeCallMessage, dayKeyOf, formatDayLabel, formatFileSize, formatLastSeen, formatMessageTime, messagePreview, parseIsoMillis, t } from './util';

const TYPING_TTL = 5_000;

interface Pending {
  file: { bytes: Uint8Array; name: string; mime: string; size: number };
}

export class RoomView {
  readonly el: HTMLElement;
  private chat: Chat | null = null;
  private messages = new Map<number, Message>();
  private rows = new Map<string, HTMLElement>();
  private sigs = new Map<string, string>();
  private hasMore = false;
  private nextBefore: number | null = null;
  private loadingOlder = false;
  private loadedOnce = false;
  private replyTo: Message | null = null;
  private editing: Message | null = null;
  private pending: Pending | null = null;
  private typing = new Map<number, { name: string; timer: number }>();
  private lastTypingSent = 0;
  private destroyed = false;
  private wsState: WsState = 'connecting';
  private serverOk = false;
  private saveTimer = 0;

  private msgsEl = h('div', { class: 'msgs' });
  private titleEl = h('div', { class: 'strong ellipsis' });
  private subEl = h('div', { class: 'sub ellipsis' });
  private avatarHost = h('div');
  private ctxHost = h('div');
  private callHost = h('div', { class: 'row' });
  private bannerHost = h('div', { class: 'call-banner-host' });
  private unsubCalls: Array<() => void> = [];
  private input = h('textarea', { rows: 1, placeholder: t('writeMessage'), spellcheck: true });
  private sendBtn = h('button', { class: 'icon-btn accent', type: 'button', title: 'Enter' }, icon('send', 20));
  private micBtn = h('button', { class: 'icon-btn', type: 'button', title: t('voiceMessage') }, icon('mic', 22));
  private barHost = h('div', { class: 'bar' });
  private recorder: MediaRecorder | null = null;
  private recChunks: Blob[] = [];
  private recStart = 0;
  private recTimer = 0;
  private recCancel = false;

  constructor(
    readonly chatId: number,
    private title: string,
  ) {
    this.titleEl.textContent = title;
    this.avatarHost.append(avatar(null, title, 40));

    const head = h(
      'div',
      { class: 'room-head', onclick: () => void this.showInfo() },
      this.avatarHost,
      h('div', { class: 'grow' }, this.titleEl, this.subEl),
      this.callHost,
      h('button', { class: 'icon-btn', type: 'button', title: t('close'), onclick: (e: Event) => (e.stopPropagation(), nav.closeRoom()) }, icon('close', 20)),
    );

    const fileInput = h('input', { type: 'file', style: { display: 'none' } });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) await this.pickFile(f);
    });
    const attachBtn = h('button', { class: 'icon-btn', type: 'button', title: t('attach'), onclick: () => fileInput.click() }, icon('attach', 22));

    this.barHost.append(attachBtn, this.input, this.micBtn, this.sendBtn);
    const composer = h('div', { class: 'composer' }, this.ctxHost, this.barHost, fileInput);

    this.el = h('div', { class: 'room' }, head, this.bannerHost, this.msgsEl, composer);
    this.unsubCalls.push(groupCalls.subscribe((id) => id === this.chatId && this.updateBanner()), call.subscribe(() => this.updateBanner()));

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.submit();
      } else if (e.key === 'Escape') {
        if (this.replyTo || this.editing || this.pending) this.clearContext();
        else nav.closeRoom();
      }
    });
    this.input.addEventListener('input', () => {
      this.input.style.height = 'auto';
      this.input.style.height = `${Math.min(140, this.input.scrollHeight)}px`;
      this.sendTyping();
    });
    this.sendBtn.addEventListener('click', () => void this.submit());
    this.micBtn.addEventListener('click', () => void this.startRecording());

    this.msgsEl.addEventListener('scroll', () => {
      if (this.msgsEl.scrollTop < 80 && this.hasMore && !this.loadingOlder) void this.loadOlder();
    });

    void this.init();
  }

  // ------------------------------------------------------------------ lifecycle

  private async init(): Promise<void> {
    // 1) offline storage first: the chat opens instantly and also works without a connection
    const [saved, savedChats] = await Promise.all([window.dt.cache.messages(this.chatId), window.dt.cache.chats()]);
    if (this.destroyed) return;
    const savedChat = savedChats.find((c) => c.id === this.chatId);
    if (savedChat) {
      this.chat = savedChat;
      this.updateHeader();
    }
    if (saved.length) {
      for (const m of saved) if (!m.is_deleted) this.messages.set(m.id, m);
      this.hasMore = saved.length >= 50;
      this.nextBefore = this.minId();
      this.loadedOnce = true;
      this.render(true);
    } else {
      this.msgsEl.append(h('div', { class: 'loading-row' }, t('loading')));
    }

    // 2) then the server: its newest page is authoritative
    const [det, page] = await Promise.all([api.getChatDetails(this.chatId), api.getMessages(this.chatId, 50)]);
    if (this.destroyed) return;
    if (det.ok) {
      this.chat = (det.data as any).chat ?? det.data;
      this.updateHeader();
      if (this.chat?.chat_type === 'group') {
        void api.getActiveCall(this.chatId).then((r) => {
          if (r.ok && !this.destroyed) groupCalls.set(this.chatId, r.data);
        });
      }
    }
    if (page.ok) {
      const fresh = page.data.messages ?? [];
      const ids = new Set(fresh.map((m) => m.id));
      const lo = fresh.length ? Math.min(...fresh.map((m) => m.id)) : Infinity;
      for (const id of [...this.messages.keys()]) if (id >= lo && !ids.has(id)) this.messages.delete(id); // deleted meanwhile
      for (const m of fresh) this.messages.set(m.id, m);
      this.hasMore = !!page.data.has_more;
      this.nextBefore = page.data.next_before_id ?? this.minId();
      this.serverOk = true;
      this.persist();
    }
    this.msgsEl.querySelector(':scope > .loading-row, :scope > .notice')?.remove();
    if (!page.ok && this.messages.size === 0) {
      this.msgsEl.append(h('div', { class: 'empty' }, h('div', { class: 'notice error' }, page.message)));
    }
    this.loadedOnce = true;
    this.render(true);
    this.markRead();
    this.input.focus();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubCalls.forEach((u) => u());
    window.clearInterval(this.recTimer);
    this.recCancel = true;
    this.recorder?.stop();
    for (const v of this.typing.values()) window.clearTimeout(v.timer);
    this.el.remove();
  }

  focusInput(): void {
    this.input.focus();
  }

  setWsState(s: WsState): void {
    const was = this.wsState;
    this.wsState = s;
    this.updateHeader();
    // Messages may have arrived while the socket was down: catch up once after (re)connect.
    if (s === 'connected' && was !== 'connected' && this.loadedOnce) void this.refreshLatest();
  }

  private minId(): number | null {
    let min: number | null = null;
    for (const id of this.messages.keys()) if (min === null || id < min) min = id;
    return min;
  }

  private sorted(): Message[] {
    // deleted messages are not shown at all
    return [...this.messages.values()].filter((m) => !m.is_deleted).sort((a, b) => a.id - b.id);
  }

  // ------------------------------------------------------------------ data

  private async loadOlder(): Promise<void> {
    if (!this.hasMore || this.loadingOlder) return;
    this.loadingOlder = true;
    const before = this.nextBefore ?? this.minId();
    const r = await api.getMessages(this.chatId, 50, before);
    this.loadingOlder = false;
    if (this.destroyed || !r.ok) return;
    const prevH = this.msgsEl.scrollHeight;
    const prevTop = this.msgsEl.scrollTop;
    for (const m of r.data.messages ?? []) this.messages.set(m.id, m);
    this.hasMore = !!r.data.has_more;
    this.nextBefore = r.data.next_before_id ?? this.minId();
    this.render(false);
    this.msgsEl.scrollTop = prevTop + (this.msgsEl.scrollHeight - prevH);
  }

  /** Merge the newest page: adds new messages, updates changed ones, drops ones deleted server-side. */
  async refreshLatest(): Promise<void> {
    if (this.destroyed || !this.loadedOnce) return;
    const r = await api.getMessages(this.chatId, 50);
    if (this.destroyed || !r.ok) return;
    const fetched = r.data.messages ?? [];
    const ids = new Set(fetched.map((m) => m.id));
    const minFetched = fetched.length ? Math.min(...fetched.map((m) => m.id)) : Infinity;
    const maxFetched = fetched.length ? Math.max(...fetched.map((m) => m.id)) : -Infinity;
    let changed = false;
    for (const m of fetched) {
      const old = this.messages.get(m.id);
      if (!old || this.signature(old) !== this.signature(m)) changed = true;
      this.messages.set(m.id, m);
    }
    for (const id of [...this.messages.keys()]) {
      // Only judge ids inside the fetched window: anything newer arrived over WS while the request was in flight.
      if (id >= minFetched && id <= maxFetched && !ids.has(id)) {
        this.messages.delete(id);
        changed = true;
      }
    }
    if (changed) this.render(false);
    this.serverOk = true;
    this.persist();
    const det = await api.getChatDetails(this.chatId);
    if (!this.destroyed && det.ok) {
      this.chat = (det.data as any).chat ?? det.data;
      this.updateHeader();
    }
  }

  /** Offline storage: keeps the newest 50 messages of this chat on disk. */
  private persist(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      if (this.serverOk) void window.dt.cache.saveMessages(this.chatId, this.sorted());
    }, 500);
  }

  private markRead(): void {
    const last = this.sorted().filter((m) => m.sender?.id !== myId()).pop();
    if (last && document.hasFocus()) void api.markChatRead(this.chatId, last.id);
  }

  // ------------------------------------------------------------------ WS events

  handleEvent(e: WsEventMsg): void {
    if (this.destroyed) return;
    switch (e.type) {
      case 'message_created': {
        const m = e.message as Message;
        if (!m || m.chat_id !== this.chatId) return;
        this.messages.set(m.id, m);
        this.clearTyping(m.sender?.id);
        const stick = this.nearBottom() || this.stickBottom;
        this.stickBottom = false;
        this.render(stick || m.sender?.id === myId());
        if (m.sender?.id !== myId()) this.markRead();
        break;
      }
      case 'message_updated': {
        const m = e.message as Message;
        if (!m || m.chat_id !== this.chatId) return;
        this.messages.set(m.id, m);
        this.render(false);
        break;
      }
      case 'message_deleted': {
        const id = Number(e.message_id);
        if (this.messages.has(id)) {
          this.messages.delete(id);
          this.render(false);
        }
        break;
      }
      case 'message_read': {
        if (e.chat_id != null && e.chat_id !== this.chatId) return;
        const uid = Number(e.user_id);
        for (const m of this.messages.values()) {
          if (m.id <= Number(e.message_id) && !(m.read_by ?? []).includes(uid)) m.read_by = [...(m.read_by ?? []), uid];
        }
        this.render(false);
        break;
      }
      case 'typing':
      case 'user_typing': {
        const uid = Number(e.user_id ?? e.user?.id);
        if (!uid || uid === myId()) return;
        const name = String(e.username ?? e.user?.username ?? '');
        if (e.is_typing === false) this.clearTyping(uid);
        else this.setTyping(uid, name);
        break;
      }
      default:
        break;
    }
  }

  private setTyping(uid: number, name: string): void {
    const old = this.typing.get(uid);
    if (old) window.clearTimeout(old.timer);
    this.typing.set(uid, { name, timer: window.setTimeout(() => this.clearTyping(uid), TYPING_TTL) });
    this.updateHeader();
  }

  private clearTyping(uid?: number | null): void {
    if (uid == null) return;
    const old = this.typing.get(uid);
    if (!old) return;
    window.clearTimeout(old.timer);
    this.typing.delete(uid);
    this.updateHeader();
  }

  private sendTyping(): void {
    const now = Date.now();
    if (now - this.lastTypingSent < 3000 || !this.input.value.trim()) return;
    this.lastTypingSent = now;
    void window.dt.ws.send({ type: 'typing', is_typing: true });
  }

  // ------------------------------------------------------------------ header

  private otherUser(): User | null {
    return this.chat?.participants?.find((p) => p.user?.id !== myId())?.user ?? null;
  }

  private updateHeader(): void {
    const c = this.chat;
    const isGroup = c?.chat_type === 'group';
    const other = this.otherUser();
    const title = c ? (isGroup ? c.title || this.title : other?.username || this.title) : this.title;
    this.titleEl.textContent = title;
    this.avatarHost.replaceChildren(avatar(isGroup ? c?.avatar : other?.avatar, title, 40, isGroup ? null : other?.is_online));
    let sub = '';
    let typing = false;
    if (this.typing.size > 0) {
      typing = true;
      const names = [...this.typing.values()].map((v) => v.name).filter(Boolean);
      sub = isGroup && names.length ? `${names.join(', ')} ${t('typing')}` : t('typing');
    } else if (this.wsState !== 'connected' && this.wsState !== 'connecting') {
      sub = t('reconnecting');
    } else if (isGroup) sub = t('members', c?.participants?.length ?? 0);
    else if (other) sub = other.is_online ? t('online') : formatLastSeen(other.last_online);
    this.callHost.replaceChildren();
    if (c && !isGroup && other) {
      this.callHost.append(
        h('button', { class: 'icon-btn', type: 'button', title: t('voiceCall'), onclick: (e: Event) => (e.stopPropagation(), startCallFromChat(this.chatId, other, false)) }, icon('call', 20)),
        h('button', { class: 'icon-btn', type: 'button', title: t('videoCall'), onclick: (e: Event) => (e.stopPropagation(), startCallFromChat(this.chatId, other, true)) }, icon('videocam', 22)),
      );
    }
    if (c && isGroup) {
      const users = this.groupUsers();
      this.callHost.append(
        h('button', { class: 'icon-btn', type: 'button', title: t('groupVoiceCall'), onclick: (e: Event) => (e.stopPropagation(), startGroupCallFromChat(this.chatId, title, users, false)) }, icon('call', 20)),
        h('button', { class: 'icon-btn', type: 'button', title: t('groupVideoCall'), onclick: (e: Event) => (e.stopPropagation(), startGroupCallFromChat(this.chatId, title, users, true)) }, icon('videocam', 22)),
      );
    }
    this.updateBanner();
    this.subEl.textContent = sub;
    this.subEl.className = 'sub ellipsis' + (typing ? ' typing' : '');
  }

  private groupUsers(): User[] {
    return (this.chat?.participants ?? []).map((p) => p.user).filter((u): u is User => !!u);
  }

  /** "Call in progress · Join" for group chats (fed by call_group_state and GET /call/api/active/). */
  private updateBanner(): void {
    const c = this.chat;
    const info = groupCalls.get(this.chatId);
    const inThis = call.busy && call.state.chatId === this.chatId;
    if (!c || c.chat_type !== 'group' || !info?.active || !info.call_id || inThis) {
      this.bannerHost.replaceChildren();
      return;
    }
    const n = info.participants?.length ?? 0;
    const full = info.max_participants != null && n >= info.max_participants;
    const names = (info.participants ?? [])
      .map((id) => this.groupUsers().find((u) => u.id === id)?.username)
      .filter(Boolean)
      .join(', ');
    this.bannerHost.replaceChildren(
      h(
        'div',
        { class: 'call-banner' },
        icon(info.media === 'video' ? 'videocam' : 'call', 20),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, t('callInProgress')), h('div', { class: 'small muted ellipsis' }, names ? t('inCallNow', names) : t('noOneInCall'))),
        h('button', { class: 'btn small', type: 'button', disabled: full || call.busy, onclick: () => joinGroupCall(this.chatId, c.title || this.title, this.groupUsers()) }, full ? t('callIsFull') : t('joinCall')),
      ),
    );
  }

  private async showInfo(): Promise<void> {
    const det = await api.getChatDetails(this.chatId);
    if (det.ok) this.chat = (det.data as any).chat ?? det.data;
    if (!this.chat) return;
    const chat = this.chat;
    openChatInfo({
      chat,
      other: this.otherUser(),
      onAdd: () => openAddParticipantsDialog(chat, () => void this.refreshLatest()),
      onRemove: async (uid) => {
        const r = await api.leaveOrRemove(chat.id, uid);
        if (!r.ok) toast(r.message, 'error');
        else void this.refreshLatest();
      },
      onLeave: async () => {
        const r = await api.leaveOrRemove(chat.id, myId());
        if (!r.ok) {
          toast(r.message, 'error');
          return;
        }
        nav.closeRoom();
        nav.reloadChats();
      },
    });
  }

  // ------------------------------------------------------------------ rendering

  private nearBottom(): boolean {
    const el = this.msgsEl;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  private signature(m: Message): string {
    const reacts = (m.reactions ?? []).map((r) => `${r.emoji}${r.user_id}`).sort().join(',');
    return [m.id, m.text, m.is_edited, m.is_deleted, m.attachment, m.reply_to, m.reply_deleted, reacts, (m.read_by ?? []).length].join('|');
  }

  private render(scrollBottom: boolean): void {
    const list = this.sorted();
    const wanted: { key: string; build: () => HTMLElement; sig: string }[] = [];
    if (this.hasMore) wanted.push({ key: 'older', sig: 'o', build: () => h('div', { class: 'loading-row' }, t('loading')) });
    if (list.length === 0 && this.loadedOnce) wanted.push({ key: 'empty', sig: 'e', build: () => h('div', { class: 'empty' }, t('noMessages')) });
    let lastDay = '';
    const showSender = this.chat?.chat_type === 'group';
    for (const m of list) {
      const ms = parseIsoMillis(m.created_at);
      const dk = ms != null ? dayKeyOf(ms) : '';
      if (dk && dk !== lastDay) {
        lastDay = dk;
        wanted.push({ key: `day:${dk}`, sig: dk, build: () => h('div', { class: 'day' }, formatDayLabel(m.created_at)) });
      }
      wanted.push({ key: `m:${m.id}`, sig: this.signature(m) + '|' + (showSender ? 1 : 0), build: () => this.buildMessage(m, showSender) });
    }

    // Keyed reconciliation: untouched rows keep their DOM nodes (so playing <audio>/<video> isn't interrupted).
    const keep = new Set(wanted.map((w) => w.key));
    for (const [k, node] of this.rows) {
      if (!keep.has(k)) {
        node.remove();
        this.rows.delete(k);
        this.sigs.delete(k);
      }
    }
    let cursor: ChildNode | null = this.msgsEl.firstChild;
    for (const w of wanted) {
      let node = this.rows.get(w.key);
      if (!node || this.sigs.get(w.key) !== w.sig) {
        const fresh = w.build();
        if (node) {
          // the replaced node may be our cursor: step past it first, or insertBefore() below would throw
          if (node === cursor) cursor = node.nextSibling;
          node.replaceWith(fresh);
        }
        node = fresh;
        this.rows.set(w.key, node);
        this.sigs.set(w.key, w.sig);
      }
      if (node === cursor) cursor = cursor.nextSibling;
      else this.msgsEl.insertBefore(node, cursor);
    }
    if (scrollBottom) this.msgsEl.scrollTop = this.msgsEl.scrollHeight;
  }

  private buildMessage(m: Message, showSender: boolean): HTMLElement {
    const callText = describeCallMessage(m, myId());
    if (callText || (m.message_type === 'system' && m.text)) {
      return h('div', { class: 'row-sys' }, h('div', { class: 'sys-pill' }, callText ? icon('call', 14) : null, h('span', null, callText ?? m.text ?? ''), h('span', { class: 'small muted' }, formatMessageTime(m.created_at))));
    }
    const mine = m.sender?.id === myId();
    const kind = attachmentKind(m);
    const bubble = h('div', { class: 'bubble' });
    if (showSender && !mine && m.sender) bubble.append(h('div', { class: 'sender', style: { color: nameColor(m.sender.username) } }, m.sender.username));

    if (m.reply_to != null) {
      const orig = this.messages.get(m.reply_to);
      bubble.append(
        h(
          'div',
          { class: 'quote', onclick: () => this.scrollTo(m.reply_to!) },
          h('div', { class: 'qn' }, orig?.sender?.username ?? '…'),
          h('div', { class: 'ellipsis' }, orig ? messagePreview(orig) : '…'),
        ),
      );
    }

    if (m.reply_to == null && m.reply_deleted) {
      // the quoted message was deleted: show a quote that leads nowhere (like Telegram)
      bubble.append(h('div', { class: 'quote dead' }, h('div', { class: 'ellipsis' }, t('deletedMessage'))));
    }

    if (m.is_deleted) {
      bubble.append(h('div', { class: 'msg-text deleted' }, t('messageDeleted')));
    } else {
      if (kind && m.attachment) {
        const src = mediaSrc(m.attachment);
        if (kind === 'image') {
          const img = h('img', { class: 'att-img', src, alt: m.attachment_name ?? '', loading: 'lazy' });
          img.addEventListener('click', () => this.openLightbox(m));
          img.addEventListener('load', () => {
            if (this.nearBottomAfterLoad) this.msgsEl.scrollTop = this.msgsEl.scrollHeight;
          });
          bubble.append(img);
        } else if (kind === 'voice') bubble.append(voicePlayer(src));
        else
          bubble.append(
            h(
              'div',
              { class: 'att-file', onclick: () => void this.saveAttachment(m) },
              icon('file', 28),
              h('div', { class: 'grow' }, h('div', { class: 'strong ellipsis' }, m.attachment_name || t('file')), h('div', { class: 'small muted' }, formatFileSize(m.attachment_size))),
              icon('download', 20),
            ),
          );
      }
      const text = m.text?.trim();
      if (text) bubble.append(h('div', { class: 'msg-text' }, ...linkify(m.text!)));
    }

    const reactions = this.groupReactions(m);
    if (reactions.length) {
      bubble.append(
        h(
          'div',
          { class: 'reactions' },
          ...reactions.map((r) => h('button', { class: 'react' + (r.mine ? ' mine' : ''), type: 'button', onclick: () => void this.toggleReaction(m, r.emoji) }, r.emoji, h('span', { class: 'small' }, String(r.count)))),
        ),
      );
    }

    const read = mine && (m.read_by ?? []).some((id) => id !== myId());
    bubble.append(
      h(
        'div',
        { class: 'meta' },
        m.is_edited && !m.is_deleted ? h('span', null, t('edited')) : null,
        h('span', null, formatMessageTime(m.created_at)),
        mine ? h('span', { class: read ? 'read' : '', title: read ? t('msgRead') : t('msgSent') }, icon(read ? 'done_all' : 'check', 14)) : null,
      ),
    );

    const row = h('div', { class: 'row-msg ' + (mine ? 'mine' : 'theirs'), dataset: { id: String(m.id) } }, bubble);
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.openMenu(ev.clientX, ev.clientY, m);
    });
    row.addEventListener('dblclick', (ev) => {
      if ((ev.target as HTMLElement).closest('a,img,button,.voice')) return;
      if (!m.is_deleted) this.startReply(m);
    });
    return row;
  }

  private nearBottomAfterLoad = true;
  private stickBottom = false;

  private groupReactions(m: Message): { emoji: string; count: number; mine: boolean }[] {
    const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const r of m.reactions ?? []) {
      const e = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
      e.count++;
      if (r.user_id === myId()) e.mine = true;
      map.set(r.emoji, e);
    }
    return [...map.values()];
  }

  private scrollTo(id: number): void {
    const node = this.rows.get(`m:${id}`);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.animate([{ background: 'rgba(255,255,255,0.18)' }, { background: 'transparent' }], { duration: 1200 });
  }

  // ------------------------------------------------------------------ actions

  private canModerate(): boolean {
    const role = this.chat?.participants?.find((p) => p.user?.id === myId())?.role?.toLowerCase();
    return role === 'owner' || role === 'admin';
  }

  private openMenu(x: number, y: number, m: Message): void {
    if (m.is_deleted) return;
    const mine = m.sender?.id === myId();
    const emojis = S.settings.reactionEmojis.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
    const bar = h('div', { class: 'react-bar' }, ...emojis.map((e) => h('button', { type: 'button', onclick: () => (document.querySelectorAll('.ctx-menu').forEach((n) => n.remove()), void this.toggleReaction(m, e)) }, e)));
    const items: MenuItem[] = [{ label: t('reply'), icon: 'reply', onClick: () => this.startReply(m) }];
    if (m.text?.trim()) items.push({ label: t('copy'), icon: 'copy', onClick: () => void navigator.clipboard.writeText(m.text ?? '').catch(() => {}) });
    if (mine && m.text && !m.attachment) items.push({ label: t('edit'), icon: 'edit', onClick: () => this.startEdit(m) });
    if (m.attachment) items.push({ label: t('download'), icon: 'download', onClick: () => void this.saveAttachment(m) });
    if (mine || this.canModerate()) items.push({ label: t('delete'), icon: 'delete', danger: true, onClick: () => void this.deleteMessage(m) });
    contextMenu(x, y, items, emojis.length ? bar : undefined);
  }

  private startReply(m: Message): void {
    this.editing = null;
    this.replyTo = m;
    this.renderContext();
    this.input.focus();
  }

  private startEdit(m: Message): void {
    this.replyTo = null;
    this.pending = null;
    this.editing = m;
    this.input.value = m.text ?? '';
    this.input.dispatchEvent(new Event('input'));
    this.renderContext();
    this.input.focus();
  }

  private clearContext(): void {
    if (this.editing) this.input.value = '';
    this.replyTo = null;
    this.editing = null;
    this.pending = null;
    this.renderContext();
    this.input.dispatchEvent(new Event('input'));
  }

  private renderContext(): void {
    this.ctxHost.replaceChildren();
    let content: HTMLElement | null = null;
    if (this.editing) content = h('div', { class: 'grow' }, h('div', { class: 'accent strong small' }, t('editingMessage')), h('div', { class: 'ellipsis small muted' }, messagePreview(this.editing)));
    else if (this.replyTo) content = h('div', { class: 'grow' }, h('div', { class: 'accent strong small' }, t('replyingTo', this.replyTo.sender?.username ?? '')), h('div', { class: 'ellipsis small muted' }, messagePreview(this.replyTo)));
    else if (this.pending) content = h('div', { class: 'grow' }, h('div', { class: 'accent strong small' }, this.pending.file.name), h('div', { class: 'small muted' }, formatFileSize(this.pending.file.size)));
    if (!content) return;
    this.ctxHost.append(h('div', { class: 'ctx-bar' }, icon(this.editing ? 'edit' : this.pending ? 'attach' : 'reply', 18), content, h('button', { class: 'icon-btn', type: 'button', onclick: () => this.clearContext() }, icon('close', 18))));
  }

  private async pickFile(f: File): Promise<void> {
    if (f.size > 100 * 1024 * 1024) {
      toast(`${f.name}: > 100 MB`, 'error');
      return;
    }
    const bytes = await readFileBytes(f);
    this.editing = null;
    this.pending = { file: { bytes, name: f.name || 'file', mime: f.type || 'application/octet-stream', size: f.size } };
    this.renderContext();
    this.input.focus();
  }

  private async submit(): Promise<void> {
    const text = this.input.value.trim();
    if (this.editing) {
      const m = this.editing;
      if (!text || text === (m.text ?? '')) return this.clearContext();
      this.sendBtn.disabled = true;
      const r = await api.editMessageHttp(m.id, text);
      this.sendBtn.disabled = false;
      if (!r.ok) return toast(r.message, 'error');
      this.editing = null;
      this.input.value = '';
      this.renderContext();
      await this.refreshLatest();
      return;
    }
    if (this.pending) {
      const p = this.pending;
      const type = p.file.mime.startsWith('image/') ? 'image' : 'file';
      this.sendBtn.disabled = true;
      const r = await api.createAttachmentMessage(this.chatId, p.file, type, text, this.replyTo?.id);
      this.sendBtn.disabled = false;
      if (!r.ok) return toast(r.message, 'error');
      this.afterHttpSend();
      return;
    }
    if (!text) return;
    const reply = this.replyTo;
    this.input.value = '';
    this.input.style.height = 'auto';
    this.replyTo = null;
    this.renderContext();
    // Realtime path: the room socket (supports replies); HTTP is the fallback when the socket is down.
    const sent = await window.dt.ws.send({ type: 'send_message', text, reply_to: reply?.id ?? null, client_message_id: crypto.randomUUID() });
    if (sent) this.stickBottom = true;
    else {
      const r = await api.createTextMessage(this.chatId, text, reply?.id, crypto.randomUUID());
      if (!r.ok) {
        this.input.value = text;
        this.replyTo = reply;
        this.renderContext();
        return toast(r.message, 'error');
      }
      await this.refreshLatest();
      this.msgsEl.scrollTop = this.msgsEl.scrollHeight;
      nav.reloadChats();
    }
  }

  private afterHttpSend(): void {
    this.pending = null;
    this.replyTo = null;
    this.input.value = '';
    this.input.style.height = 'auto';
    this.renderContext();
    void this.refreshLatest().then(() => (this.msgsEl.scrollTop = this.msgsEl.scrollHeight));
    nav.reloadChats();
  }

  private async deleteMessage(m: Message): Promise<void> {
    if (!(await confirmDialog(t('confirmDeleteMsg'), t('delete')))) return;
    const mine = m.sender?.id === myId();
    if (mine && (await window.dt.ws.send({ type: 'delete_message', message_id: m.id }))) {
      window.setTimeout(() => void this.refreshLatest(), 1500); // safety net if the echo is missed
      return;
    }
    const r = await api.deleteMessageHttp(m.id);
    if (!r.ok) return toast(r.message, 'error');
    this.messages.delete(m.id);
    this.render(false);
    nav.reloadChats();
  }

  private async toggleReaction(m: Message, emoji: string): Promise<void> {
    const me = myId();
    const has = (m.reactions ?? []).some((r) => r.emoji === emoji && r.user_id === me);
    const before = m.reactions ?? [];
    // optimistic
    m.reactions = has ? before.filter((r) => !(r.emoji === emoji && r.user_id === me)) : [...before, { emoji, user_id: me } as Reaction];
    this.render(false);
    const r = has ? await api.removeReaction(m.id, emoji) : await api.addReaction(m.id, emoji);
    if (!r.ok) {
      m.reactions = before;
      this.render(false);
      toast(r.message, 'error');
    }
  }

  private async saveAttachment(m: Message): Promise<void> {
    if (!m.attachment) return;
    const r = await window.dt.saveFile(m.attachment, m.attachment_name || 'file');
    if (r.ok && r.path) toast(t('downloaded', r.path), 'success');
    else if (r.error) toast(r.error, 'error');
  }

  private openLightbox(m: Message): void {
    let close: () => void = () => {};
    const box = h(
      'div',
      { class: 'lightbox' },
      h('img', { src: mediaSrc(m.attachment), alt: '' }),
      h(
        'div',
        { class: 'tools' },
        h('button', { class: 'icon-btn', type: 'button', title: t('download'), onclick: () => void this.saveAttachment(m) }, icon('download', 20)),
        h('button', { class: 'icon-btn', type: 'button', title: t('close'), onclick: () => close() }, icon('close', 20)),
      ),
    );
    close = openModal(box, { bare: true });
  }

  // ------------------------------------------------------------------ voice

  private async startRecording(): Promise<void> {
    if (this.recorder) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast(t('micDenied'), 'error');
      return;
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.recorder = rec;
    this.recChunks = [];
    this.recCancel = false;
    this.recStart = Date.now();
    rec.ondataavailable = (e) => e.data.size && this.recChunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      window.clearInterval(this.recTimer);
      this.recorder = null;
      this.restoreBar();
      if (this.recCancel || this.destroyed) return;
      if (Date.now() - this.recStart < 600) return;
      const blob = new Blob(this.recChunks, { type: rec.mimeType || 'audio/webm' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const r = await api.createAttachmentMessage(this.chatId, { bytes, name: `voice_${Date.now()}.webm`, mime: 'audio/webm' }, 'voice_message', undefined, this.replyTo?.id);
      if (!r.ok) return toast(r.message, 'error');
      this.afterHttpSend();
    };
    rec.start();

    const timeEl = h('span', { class: 'strong' }, '0:00');
    this.recTimer = window.setInterval(() => {
      const s = Math.floor((Date.now() - this.recStart) / 1000);
      timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    this.barHost.replaceChildren(
      h('button', { class: 'icon-btn danger', type: 'button', onclick: () => ((this.recCancel = true), rec.stop()) }, icon('delete', 22)),
      h('div', { class: 'grow row center-y gap-s' }, h('span', { class: 'rec-dot' }), h('span', null, t('recording')), timeEl),
      h('button', { class: 'icon-btn accent', type: 'button', onclick: () => rec.stop() }, icon('send', 20)),
    );
  }

  private restoreBar(): void {
    const fileBtn = this.fileButton();
    this.barHost.replaceChildren(fileBtn, this.input, this.micBtn, this.sendBtn);
  }

  private fileButton(): HTMLElement {
    const fileInput = h('input', { type: 'file', style: { display: 'none' } });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) await this.pickFile(f);
    });
    return h('button', { class: 'icon-btn', type: 'button', title: t('attach'), onclick: () => fileInput.click() }, icon('attach', 22), fileInput);
  }
}

const SPEEDS = [1, 1.5, 2];

/** Voice message player with 1x / 1.5x / 2x speed (same as the Android client). */
function voicePlayer(src: string): HTMLElement {
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.src = src;
  let speedIdx = 0;
  const fmt = (x: number): string => (Number.isFinite(x) ? `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}` : '0:00');
  const playBtn = h('button', { class: 'voice-play', type: 'button' }, icon('play', 22));
  const bar = h('div', { class: 'voice-bar' }, h('div', { class: 'voice-fill' }));
  const fill = bar.firstElementChild as HTMLElement;
  const time = h('span', { class: 'small muted voice-time' }, '0:00');
  const speed = h('button', { class: 'voice-speed', type: 'button', title: t('speed') }, '1x');
  const update = (): void => {
    const d = audio.duration;
    fill.style.width = Number.isFinite(d) && d > 0 ? `${(audio.currentTime / d) * 100}%` : '0%';
    time.textContent = audio.paused && audio.currentTime === 0 ? fmt(d) : fmt(audio.currentTime);
  };
  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      document.querySelectorAll<HTMLElement>('.voice[data-playing="1"] .voice-play').forEach((b) => b.click());
      void audio.play();
    } else audio.pause();
  });
  const root = h('div', { class: 'voice' }, playBtn, h('div', { class: 'grow col' }, bar, time), speed);
  audio.addEventListener('play', () => ((root.dataset.playing = '1'), playBtn.replaceChildren(icon('pause', 22))));
  audio.addEventListener('pause', () => ((root.dataset.playing = '0'), playBtn.replaceChildren(icon('play', 22))));
  audio.addEventListener('ended', () => ((audio.currentTime = 0), update()));
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('loadedmetadata', update);
  bar.addEventListener('click', (e) => {
    const r = bar.getBoundingClientRect();
    if (Number.isFinite(audio.duration)) audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  speed.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    audio.playbackRate = SPEEDS[speedIdx];
    speed.textContent = `${SPEEDS[speedIdx]}x`;
  });
  return root;
}
