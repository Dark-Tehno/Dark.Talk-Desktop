import { contextBridge, ipcRenderer } from 'electron';
import type { DtApi, WsEventMsg, WsScope, WsState } from '../shared/types';

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: DtApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  auth: {
    setSession: (s) => ipcRenderer.invoke('auth:setSession', s),
    clear: () => ipcRenderer.invoke('auth:clear'),
  },
  api: (req) => ipcRenderer.invoke('api:request', req),
  ws: {
    connectChats: () => ipcRenderer.invoke('ws:connectChats'),
    enterRoom: (id) => ipcRenderer.invoke('ws:enterRoom', id),
    leaveRoom: () => ipcRenderer.invoke('ws:leaveRoom'),
    disconnect: () => ipcRenderer.invoke('ws:disconnect'),
    reconnect: () => ipcRenderer.invoke('ws:reconnect'),
    send: (payload) => ipcRenderer.invoke('ws:send', payload),
    sendCall: (payload) => ipcRenderer.invoke('ws:sendCall', payload),
  },
  onWsEvent: (cb) => listen<WsEventMsg>('ws:event', cb),
  onWsState: (cb) => listen<{ scope: WsScope; state: WsState }>('ws:state', (p) => cb(p.scope, p.state)),
  onAuthCleared: (cb) => listen<void>('auth:cleared', () => cb()),
  saveFile: (url, name) => ipcRenderer.invoke('file:save', url, name),
  cache: {
    me: () => ipcRenderer.invoke('cache:me'),
    setMe: (u) => ipcRenderer.invoke('cache:setMe', u),
    chats: () => ipcRenderer.invoke('cache:chats'),
    saveChats: (c) => ipcRenderer.invoke('cache:saveChats', c),
    messages: (id) => ipcRenderer.invoke('cache:messages', id),
    saveMessages: (id, m) => ipcRenderer.invoke('cache:saveMessages', id, m),
    sizes: () => ipcRenderer.invoke('cache:sizes'),
    clearData: () => ipcRenderer.invoke('cache:clearData'),
    clearMedia: () => ipcRenderer.invoke('cache:clearMedia'),
    listMedia: () => ipcRenderer.invoke('cache:listMedia'),
    deleteMedia: (keys) => ipcRenderer.invoke('cache:deleteMedia', keys),
  },
  screen: {
    sources: () => ipcRenderer.invoke('screen:sources'),
    select: (id) => ipcRenderer.invoke('screen:select', id),
  },
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
};

contextBridge.exposeInMainWorld('dt', api);
