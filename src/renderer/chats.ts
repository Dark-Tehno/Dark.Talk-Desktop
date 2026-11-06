import type { Chat, Message, WsEventMsg, WsState } from '../shared/types';
import * as api from './api';
import { S, myId, nav } from './state';
import { avatar, confirmDialog, contextMenu, h, icon, textInput, toast } from './ui';
import { chatPreview, chatTitle, debounce, formatChatListTime, messagePreview, t } from './util';

type Filter = 'all' | 'direct' | 'group' | 'unread';

export interface Sidebar {
  el: HTMLElement;
  reload(): Promise<void>;
  setActive(id: number | null): void;
  setConnState(state: WsState): void;
  handleEvent(e: WsEventMsg, openChatId: number | null): void;
  unreadTotal(): number;
  stop(): void;
}

export function buildSidebar(onUnreadChange: (n: number) => void): Sidebar {
  let chats: Chat[] = [];
  let filter: Filter = 'all';
  let query = '';
  let activeId: number | null = null;
  let loaded = false;
  let loadError: string | null = null;
  let lastState: WsState = 'connecting';
  let serverOk = false; // the list below came from (or was confirmed by) the server
  let saveTimer = 0;

  const conn = h('span', { class: 'conn ok' });
  const list = h('div', { class: 'chat-list' });
  const search = textInput({ placeholder: t('searchChats') });
  const filtersEl = h('div', { class: 'filters' });

  const head = h(
    'div',
    { class: 'side-head' },
    avatar(S.me?.avatar, S.settings.username ?? '?', 36),
    h('div', { class: 'title' }, 'Dark.Talk'),
    conn,
    h('button', { class: 'icon-btn', title: t('newGroup'), type: 'button', onclick: () => void import('./dialogs').then((m) => m.openNewGroupDialog()) }, icon('group', 20)),
    h('button', { class: 'icon-btn', title: t('newDirect'), type: 'button', onclick: () => void import('./dialogs').then((m) => m.openNewDirectDialog()) }, icon('edit', 20)),
    h('button', { class: 'icon-btn', title: t('settings'), type: 'button', onclick: () => nav.openSettings() }, icon('settings', 20)),
  );

  const el = h('div', { class: 'sidebar' }, head, h('div', { class: 'side-search' }, search), filtersEl, list);

  const unreadTotal = (): number => chats.reduce((a, c) => a + (c.unread_count ?? 0), 0);

  const sortChats = (): void => {
    const ts = (c: Chat): number => Date.parse(c.last_message?.created_at ?? c.updated_at ?? c.created_at ?? '') || 0;
    chats.sort((a, b) => ts(b) - ts(a));
  };

  const renderFilters = (): void => {
    const mk = (f: Filter, label: string): HTMLElement =>
      h('button', { class: 'chip' + (filter === f ? ' selected' : ''), type: 'button', onclick: () => ((filter = f), renderFilters(), render()) }, label);
    filtersEl.replaceChildren(mk('all', t('all')), mk('direct', t('direct')), mk('group', t('groups')), mk('unread', t('unread')));
  };

  const visible = (): Chat[] => {
    const q = query.trim().toLowerCase();
    return chats.filter((c) => {
      if (filter === 'direct' && c.chat_type === 'group') return false;
      if (filter === 'group' && c.chat_type !== 'group') return false;
      if (filter === 'unread' && !(c.unread_count && c.unread_count > 0)) return false;
      if (!q) return true;
      const title = chatTitle(c, myId()).toLowerCase();
      const prev = chatPreview(c, myId()).toLowerCase();
      return title.includes(q) || prev.includes(q);
    });
  };

  const confirmDeleteOrLeave = async (c: Chat): Promise<void> => {
    const title = chatTitle(c, myId());
    const isGroup = c.chat_type === 'group';
    const ok = await confirmDialog(t(isGroup ? 'confirmLeave' : 'confirmDeleteChat', title), t(isGroup ? 'leaveGroup' : 'delete'));
    if (!ok) return;
    const r = isGroup ? await api.leaveOrRemove(c.id, myId()) : await api.deleteChat(c.id);
    if (!r.ok) {
      toast(r.message, 'error');
      return;
    }
    chats = chats.filter((x) => x.id !== c.id);
    if (activeId === c.id) nav.closeRoom();
    render();
    notifyUnread();
  };

  const item = (c: Chat): HTMLElement => {
    const title = chatTitle(c, myId());
    const other = c.participants?.find((p) => p.user?.id !== myId())?.user;
    const av = c.chat_type === 'group' ? c.avatar : other?.avatar;
    const unread = c.unread_count ?? 0;
    const when = c.last_message?.created_at ?? c.updated_at;
    const row = h(
      'div',
      { class: 'chat-item' + (c.id === activeId ? ' active' : ''), dataset: { id: String(c.id) }, onclick: () => nav.openChat(c.id, title) },
      avatar(av, title, 48, c.chat_type === 'group' ? null : other?.is_online),
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'top' }, h('div', { class: 'name ellipsis' }, title), h('div', { class: 'time' }, formatChatListTime(when))),
        h('div', { class: 'bottom' }, h('div', { class: 'preview ellipsis' }, chatPreview(c, myId())), unread > 0 ? h('span', { class: 'badge' }, unread > 99 ? '99+' : unread) : null),
      ),
    );
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      contextMenu(ev.clientX, ev.clientY, [
        { label: c.chat_type === 'group' ? t('leaveGroup') : t('deleteChat'), icon: c.chat_type === 'group' ? 'logout' : 'delete', danger: true, onClick: () => void confirmDeleteOrLeave(c) },
      ]);
    });
    return row;
  };

  /** Offline storage: the chat list (with last messages) is saved after every change that came from the server. */
  const persist = (): void => {
    if (!serverOk) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void window.dt.cache.saveChats(chats), 700);
  };

  const render = (): void => {
    persist();
    const v = visible();
    if (!loaded) {
      list.replaceChildren(h('div', { class: 'empty' }, t('loading')));
      return;
    }
    if (loadError && chats.length === 0) {
      list.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'notice error' }, loadError)));
      return;
    }
    if (v.length === 0) {
      list.replaceChildren(
        chats.length === 0
          ? h('div', { class: 'empty' }, h('div', { class: 'strong' }, t('noChats')), h('div', { class: 'small' }, t('noChatsHint')))
          : h('div', { class: 'empty' }, t('noMatch')),
      );
      return;
    }
    list.replaceChildren(...v.map(item));
  };

  const notifyUnread = (): void => onUnreadChange(unreadTotal());

  const reload = async (): Promise<void> => {
    // Show the saved list immediately, the server answer replaces it (or the saved list stays when offline).
    if (!loaded && chats.length === 0) {
      const saved = await window.dt.cache.chats();
      if (saved.length && chats.length === 0) {
        chats = saved;
        sortChats();
        loaded = true;
        render();
        notifyUnread();
      }
    }
    const r = await api.getChats();
    loaded = true;
    if (!r.ok) {
      loadError = r.message;
      render();
      return;
    }
    serverOk = true;
    loadError = null;
    chats = r.data;
    sortChats();
    render();
    notifyUnread();
    chats.filter((c) => c.last_message?.is_deleted).forEach((c) => void fixDeletedPreview(c));
  };

  /** The list preview must show the newest message that still exists, not "message deleted". */
  const fixDeletedPreview = async (c: Chat): Promise<void> => {
    const r = await api.getMessages(c.id, 20);
    if (!r.ok) return;
    const live = (r.data.messages ?? []).filter((m) => !m.is_deleted);
    c.last_message = live.length ? live[live.length - 1] : null;
    render();
  };

  search.addEventListener(
    'input',
    debounce(() => {
      query = search.value;
      render();
    }, 150),
  );

  const applyMessage = (m: Message, openChatId: number | null): void => {
    const c = chats.find((x) => x.id === m.chat_id);
    if (!c) {
      void reload(); // unknown chat (e.g. just created by someone else)
      return;
    }
    const prev = c.last_message;
    if (!prev || prev.id <= m.id) {
      c.last_message = m;
      c.last_message_id = m.id;
      c.updated_at = m.created_at ?? c.updated_at;
    }
    if (m.sender?.id !== myId() && m.chat_id !== openChatId) {
      c.unread_count = (c.unread_count ?? 0) + 1;
      notify(c, m);
    }
    sortChats();
    render();
    notifyUnread();
  };

  const notify = (c: Chat, m: Message): void => {
    if (document.hasFocus() || !('Notification' in window)) return;
    try {
      if (Notification.permission === 'default') void Notification.requestPermission();
      if (Notification.permission !== 'granted') return;
      const n = new Notification(chatTitle(c, myId()), { body: `${c.chat_type === 'group' && m.sender ? m.sender.username + ': ' : ''}${messagePreview(m)}`, silent: false });
      n.onclick = () => {
        window.focus();
        nav.openChat(c.id, chatTitle(c, myId()));
      };
    } catch {
      /* notifications are best effort */
    }
  };

  return {
    el,
    reload,
    unreadTotal,
    stop: () => {},
    setActive(id) {
      activeId = id;
      if (id != null) {
        const c = chats.find((x) => x.id === id);
        if (c && c.unread_count) {
          c.unread_count = 0;
          notifyUnread();
        }
      }
      render();
    },
    setConnState(state) {
      // Re-sync the list after the socket comes back (events could have been missed meanwhile).
      if (state === 'connected' && lastState !== 'connected' && loaded) void reload();
      lastState = state;
      conn.className = 'conn' + (state === 'connected' ? ' ok' : '');
      conn.textContent = state === 'connecting' ? t('connecting') : state === 'connected' ? '' : t('noConnection');
    },
    handleEvent(e, openChatId) {
      switch (e.type) {
        case 'message_created':
          if (e.message) applyMessage(e.message as Message, openChatId);
          break;
        case 'message_updated': {
          const m = e.message as Message | undefined;
          const c = m && chats.find((x) => x.id === m.chat_id);
          if (c && m && c.last_message?.id === m.id) {
            c.last_message = m;
            render();
          }
          break;
        }
        case 'message_deleted': {
          const c = chats.find((x) => x.last_message?.id === e.message_id);
          if (c && c.last_message) {
            c.last_message = { ...c.last_message, is_deleted: true, text: null, attachment: null };
            render();
            void fixDeletedPreview(c);
          }
          break;
        }
        case 'chat_created':
        case 'chat_updated':
        case 'chat_deleted':
        case 'participant_added':
        case 'participant_removed':
          void reload();
          break;
        default:
          break;
      }
    },
  };
}
