import type { Chat, User } from '../shared/types';
import * as api from './api';
import { S, myId, nav } from './state';
import { avatar, banner, btn, field, h, icon, openModal, setBusy, textInput, userRow } from './ui';
import { debounce, formatLastSeen, t } from './util';

/** Debounced username search. `onPick` is called when a row is clicked. */
export function userSearch(opts: {
  exclude?: () => Set<number>;
  isSelected?: (u: User) => boolean;
  onPick: (u: User) => void;
  placeholder?: string;
}): { el: HTMLElement; input: HTMLInputElement; rerender: () => void } {
  const input = textInput({ placeholder: opts.placeholder ?? t('searchUsersHint') });
  const list = h('div', { class: 'user-list' });
  let results: User[] = [];
  let seq = 0;

  const rerender = (): void => {
    const ex = opts.exclude?.() ?? new Set<number>();
    list.replaceChildren(
      ...results
        .filter((u) => u.id !== myId() && !ex.has(u.id))
        .map((u) => userRow(u, opts.isSelected?.(u) ?? false, () => opts.onPick(u))),
    );
  };

  const run = debounce(async (q: string) => {
    const mine = ++seq;
    if (!q.trim()) {
      results = [];
      rerender();
      return;
    }
    const r = await api.searchUsers(q.trim());
    if (mine !== seq) return; // a newer query is already running
    results = r.ok ? r.data.users ?? [] : [];
    rerender();
  }, 300);

  input.addEventListener('input', () => run(input.value));
  return { el: h('div', { class: 'col gap' }, input, list), input, rerender };
}

export function openNewDirectDialog(): void {
  let close: () => void = () => {};
  const msg = h('div');
  const go = async (name: string, startBtn?: HTMLButtonElement): Promise<void> => {
    if (!name.trim()) return;
    if (startBtn) setBusy(startBtn, true);
    const r = await api.createDirectChat(name);
    if (startBtn) setBusy(startBtn, false);
    if (!r.ok) {
      msg.replaceChildren(banner('error', r.message));
      return;
    }
    close();
    nav.reloadChats();
    nav.openChat(r.data.chat_id, name.trim());
  };
  const search = userSearch({ onPick: (u) => void go(u.username) });
  const start = btn(t('startChat'), () => void go(search.input.value, start));
  search.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start.click();
  });
  close = openModal(
    h('div', { class: 'dialog' }, h('div', { class: 'dialog-title' }, t('newDirect')), h('div', { class: 'muted' }, t('searchUsers')), search.el, msg, h('div', { class: 'row end gap' }, btn(t('cancel'), () => close(), { secondary: true }), start)),
  );
  setTimeout(() => search.input.focus(), 50);
}

export function openNewGroupDialog(): void {
  let close: () => void = () => {};
  const selected = new Map<number, User>();
  const msg = h('div');
  const chips = h('div', { class: 'chips-row' });
  const title = textInput({ placeholder: 'Project Team' });
  const desc = textInput({ placeholder: '' });

  const renderChips = (): void => {
    chips.replaceChildren(
      ...[...selected.values()].map((u) =>
        h('button', { class: 'chip selected', type: 'button', onclick: () => (selected.delete(u.id), renderChips(), search.rerender()) }, u.username, ' ✕'),
      ),
    );
  };
  const search = userSearch({
    isSelected: (u) => selected.has(u.id),
    onPick: (u) => {
      if (selected.has(u.id)) selected.delete(u.id);
      else selected.set(u.id, u);
      renderChips();
      search.rerender();
    },
  });
  const create = btn(t('createGroup'), async () => {
    if (selected.size === 0) {
      msg.replaceChildren(banner('error', t('addOne')));
      return;
    }
    setBusy(create, true);
    const names = [...selected.values()].map((u) => u.username).join(',');
    const r = await api.createGroupChat(names, title.value.trim(), desc.value.trim());
    setBusy(create, false);
    if (!r.ok) {
      msg.replaceChildren(banner('error', r.message));
      return;
    }
    close();
    nav.reloadChats();
    nav.openChat(r.data.chat_id, title.value.trim() || `Group #${r.data.chat_id}`);
  });
  close = openModal(
    h(
      'div',
      { class: 'dialog' },
      h('div', { class: 'dialog-title' }, t('newGroup')),
      field(t('groupTitle'), title),
      field(t('description'), desc),
      field(t('participants'), search.el),
      chips,
      msg,
      h('div', { class: 'row end gap' }, btn(t('cancel'), () => close(), { secondary: true }), create),
    ),
  );
  setTimeout(() => title.focus(), 50);
}

export function openAddParticipantsDialog(chat: Chat, onAdded: () => void): void {
  let close: () => void = () => {};
  const existing = new Set((chat.participants ?? []).map((p) => p.user?.id).filter((x): x is number => x != null));
  const selected = new Map<number, User>();
  const msg = h('div');
  const chips = h('div', { class: 'chips-row' });
  const renderChips = (): void => {
    chips.replaceChildren(...[...selected.values()].map((u) => h('button', { class: 'chip selected', type: 'button', onclick: () => (selected.delete(u.id), renderChips(), search.rerender()) }, u.username, ' ✕')));
  };
  const search = userSearch({
    exclude: () => existing,
    isSelected: (u) => selected.has(u.id),
    onPick: (u) => {
      if (selected.has(u.id)) selected.delete(u.id);
      else selected.set(u.id, u);
      renderChips();
      search.rerender();
    },
  });
  const add = btn(t('add'), async () => {
    if (selected.size === 0) return;
    setBusy(add, true);
    const r = await api.addParticipants(chat.id, [...selected.values()].map((u) => u.username));
    setBusy(add, false);
    if (!r.ok) {
      msg.replaceChildren(banner('error', r.message));
      return;
    }
    close();
    onAdded();
  });
  close = openModal(h('div', { class: 'dialog' }, h('div', { class: 'dialog-title' }, t('addParticipants')), search.el, chips, msg, h('div', { class: 'row end gap' }, btn(t('cancel'), () => close(), { secondary: true }), add)));
  setTimeout(() => search.input.focus(), 50);
}

export function openChatInfo(opts: {
  chat: Chat;
  other: User | null;
  onAdd: () => void;
  onRemove: (userId: number) => void;
  onLeave: () => void;
}): void {
  const { chat, other } = opts;
  const me = myId();
  const isGroup = chat.chat_type === 'group';
  const myRole = chat.participants?.find((p) => p.user?.id === me)?.role?.toLowerCase();
  const canModerate = myRole === 'owner' || myRole === 'admin';
  let close: () => void = () => {};

  const headTitle = isGroup ? chat.title || 'Group' : other?.username || chat.title || 'User';
  const head = h(
    'div',
    { class: 'col center-x gap-s' },
    avatar(isGroup ? chat.avatar : other?.avatar, headTitle, 84, isGroup ? null : other?.is_online),
    h('div', { class: 'dialog-title' }, headTitle),
    isGroup
      ? h('div', { class: 'accent' }, t('members', chat.participants?.length ?? 0))
      : other
        ? h('div', { class: other.is_online ? 'success small' : 'muted small' }, other.is_online ? t('online') : formatLastSeen(other.last_online))
        : null,
  );

  const body = h('div', { class: 'col gap' });
  if (!isGroup && other) {
    const rows: [string, string, string][] = [];
    if (other.info) rows.push(['info', t('bio'), other.info]);
    if (other.language) rows.push(['person', t('language'), other.language]);
    if (other.date_of_birth) rows.push(['person', t('dob'), other.date_of_birth]);
    body.append(
      h(
        'div',
        { class: 'info-card' },
        ...(rows.length
          ? rows.map(([ic, label, value]) => h('div', { class: 'info-row' }, icon(ic, 20), h('div', null, h('div', { class: 'muted small' }, label), h('div', { class: 'strong' }, value))))
          : [h('div', { class: 'muted' }, t('noInfo'))]),
      ),
    );
  } else if (isGroup) {
    if (chat.description) body.append(h('div', { class: 'info-card' }, chat.description));
    body.append(
      h('div', { class: 'row between center-y' }, h('div', { class: 'muted strong' }, `${t('participants')} (${chat.participants?.length ?? 0})`), canModerate ? btn(t('add'), () => (close(), opts.onAdd()), { secondary: true, icon: 'person_add' }) : null),
    );
    const list = h('div', { class: 'col gap-s' });
    for (const p of chat.participants ?? []) {
      const u = p.user;
      if (!u) continue;
      const role = (p.role ?? 'member').toLowerCase();
      list.append(
        h(
          'div',
          { class: 'member-row' },
          avatar(u.avatar, u.username, 40, u.is_online),
          h('div', { class: 'grow' }, h('div', { class: 'strong' }, u.username), h('div', { class: u.is_online ? 'success small' : 'muted small' }, u.id === me ? t('you') : u.is_online ? t('online') : t('offline'))),
          role === 'owner' || role === 'admin' ? h('span', { class: 'role ' + role }, role === 'owner' ? t('owner') : t('admin')) : null,
          canModerate && u.id !== me && role !== 'owner' ? h('button', { class: 'icon-btn danger', type: 'button', title: t('remove'), onclick: () => (opts.onRemove(u.id), close()) }, icon('close', 18)) : null,
        ),
      );
    }
    body.append(list);
    if (myRole !== 'owner') body.append(btn(t('leaveGroup'), () => (close(), opts.onLeave()), { secondary: true, danger: true, icon: 'logout' }));
  }

  close = openModal(h('div', { class: 'dialog' }, head, body, h('div', { class: 'row end' }, btn(t('close'), () => close(), { secondary: true }))), { wide: false });
  void S;
}
