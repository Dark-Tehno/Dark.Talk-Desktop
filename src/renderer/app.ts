import * as api from './api';
import { buildAuthView } from './auth';
import { buildSidebar, type Sidebar } from './chats';
import { call, mountCallUi } from './call';
import { RoomView } from './room';
import { applyThemeVars, openSettings } from './settings';
import { S, nav } from './state';
import { h, icon, toast } from './ui';
import { setLanguage, t } from './util';

const root = document.getElementById('app') as HTMLElement;

let sidebar: Sidebar | null = null;
let room: RoomView | null = null;
let main: HTMLElement | null = null;
let openChatId: number | null = null;
let unsubs: (() => void)[] = [];
let unmountCall: (() => void) | null = null;

function placeholder(): HTMLElement {
  return h('div', { class: 'placeholder' }, h('div', { class: 'big-icon' }, icon('send', 36)), h('div', null, t('selectChat')));
}

function teardownShell(): void {
  for (const u of unsubs) u();
  unsubs = [];
  sidebar?.stop();
  sidebar = null;
  room?.destroy();
  room = null;
  openChatId = null;
  document.title = 'Dark.Talk';
  unmountCall?.();
  unmountCall = null;
  if (call.busy) call.hangUp();
  void window.dt.ws.disconnect();
}

function showAuth(): void {
  teardownShell();
  root.replaceChildren(buildAuthView(() => void showShell()));
}

/** Pulls the latest data over HTTP (events may have been missed while a socket was down or the window slept). */
function catchUp(): void {
  void sidebar?.reload();
  void room?.refreshLatest();
}

async function showShell(): Promise<void> {
  teardownShell();
  if (!S.me) {
    const p = await api.getProfile();
    if (p.ok) {
      S.me = (p.data as any).user ?? p.data;
      void window.dt.cache.setMe(S.me);
    } else if (p.status === 401 || p.status === 403) return showAuth();
    else S.me = await window.dt.cache.me(); // server unreachable: work from the saved profile
  }
  if (S.me?.language) setLanguage(S.me.language);

  sidebar = buildSidebar((n) => {
    document.title = n > 0 ? `(${n}) Dark.Talk` : 'Dark.Talk';
  });
  main = h('div', { class: 'main' }, placeholder());
  root.replaceChildren(h('div', { class: 'shell' }, sidebar.el, main));

  unsubs.push(
    window.dt.onWsEvent((e) => {
      if (e.type.startsWith('call_')) {
        call.handleEvent(e);
        // The call record is posted to the chat as a message: make sure the open chat / list are up to date afterwards.
        if (e.type === 'call_ended') window.setTimeout(catchUp, 1200);
        return;
      }
      // one failing view must never starve the other
      try {
        sidebar?.handleEvent(e, openChatId);
      } catch (err) {
        console.error('sidebar event', err);
      }
      try {
        room?.handleEvent(e);
      } catch (err) {
        console.error('room event', err);
      }
    }),
    window.dt.onWsState((scope, state) => {
      if (scope === 'chats') {
        sidebar?.setConnState(state);
        call.onSocketState(state);
        if (state === 'connected') window.setTimeout(catchUp, 300);
      }
      else room?.setWsState(state);
    }),
  );

  unmountCall = mountCallUi();
  const onFocus = (): void => catchUp();
  const onOnline = (): void => void window.dt.ws.reconnect();
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  unsubs.push(() => (window.removeEventListener('focus', onFocus), window.removeEventListener('online', onOnline)));
  await window.dt.ws.connectChats();
  await sidebar.reload();
}

function openChat(chatId: number, title: string): void {
  if (!main || !sidebar) return;
  if (room && openChatId === chatId) {
    room.focusInput();
    return;
  }
  room?.destroy();
  openChatId = chatId;
  room = new RoomView(chatId, title);
  main.replaceChildren(room.el);
  sidebar.setActive(chatId);
  void window.dt.ws.enterRoom(chatId);
}

function closeRoom(): void {
  if (!main) return;
  room?.destroy();
  room = null;
  openChatId = null;
  main.replaceChildren(placeholder());
  sidebar?.setActive(null);
  void window.dt.ws.leaveRoom();
}

nav.openChat = openChat;
nav.closeRoom = closeRoom;
nav.reloadChats = () => void sidebar?.reload();
nav.openSettings = (tab) => openSettings(tab ?? 0);
nav.applyTheme = applyThemeVars;
nav.rebuild = () => {
  // Language / server / profile changed: rebuild the whole UI from fresh settings.
  void window.dt.settings.get().then(async (s) => {
    S.settings = s;
    setLanguage(s.userLanguage);
    if (s.isLoggedIn) await showShell();
    else showAuth();
  });
};
nav.signedOut = () => showAuth();

async function boot(): Promise<void> {
  S.settings = await window.dt.settings.get();
  setLanguage(S.settings.userLanguage);
  applyThemeVars(S.settings.appTheme);
  window.dt.onAuthCleared(() => {
    S.me = null;
    void window.dt.settings.get().then((s) => {
      S.settings = s;
      showAuth();
      toast(t('noConnection'), 'error');
    });
  });
  if (S.settings.isLoggedIn) await showShell();
  else showAuth();
}

void boot();
