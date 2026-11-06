// Shapes mirror the server JSON (snake_case) described in the Dark.Talk README.

export interface User {
  id: number;
  username: string;
  email?: string | null;
  avatar?: string | null;
  info?: string | null;
  date_of_birth?: string | null;
  language?: string | null;
  is_online?: boolean | null;
  last_online?: string | null;
  email_confirmed?: boolean | null;
  two_factor_enabled?: boolean | null;
  date_joined?: string | null;
}

export interface Device {
  id?: string | null;
  device_id: string;
  name?: string | null;
  device_type?: string | null;
  trusted?: boolean | null;
  blocked?: boolean | null;
  last_seen?: string | null;
  created_at?: string | null;
}

export interface LoginHistoryItem {
  id?: number | null;
  device?: string | null;
  ip?: string | null;
  country?: string | null;
  city?: string | null;
  status?: string | null;
  reason?: string | null;
  created_at?: string | null;
}

export interface AuthResponse {
  status?: string;
  token?: string;
  user?: User;
  device?: Device;
  challenge_id?: string;
  expires_at?: string;
  detail?: string;
}

export interface Participant {
  id?: number | null;
  user?: User | null;
  role?: string | null;
  is_muted?: boolean | null;
  left_at?: string | null;
}

export interface Reaction {
  id?: number | null;
  user_id?: number | null;
  emoji: string;
  created_at?: string | null;
}

export interface Message {
  id: number;
  chat_id: number;
  sender?: User | null;
  reply_to?: number | null;
  reply_deleted?: boolean;
  message_type?: string;
  text?: string | null;
  attachment?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  metadata?: Record<string, unknown> | null;
  is_edited?: boolean;
  is_deleted?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  reactions?: Reaction[];
  read_by?: number[];
  client_message_id?: string | null;
}

export interface Chat {
  id: number;
  chat_type: string; // "direct" | "group"
  title?: string | null;
  description?: string | null;
  avatar?: string | null;
  created_by?: User | null;
  created_at?: string | null;
  updated_at?: string | null;
  unread_count?: number;
  participants?: Participant[];
  last_message_id?: number | null;
  last_message?: Message | null;
}

/** Group call record in Message.metadata.call (see backend call/CALLS.md). */
export interface CallMetadata {
  status: string; // ended | rejected | cancelled | missed
  media?: 'audio' | 'video';
  duration?: number;
  caller_id?: number;
  group?: boolean;
  participants?: number[];
}

/** Response of GET /call/api/active/?chat_id= and payload of the `call_group_state` event. */
export interface ActiveCallInfo {
  active: boolean;
  call_id?: string | null;
  participants?: number[];
  media?: 'audio' | 'video' | string | null;
  max_participants?: number | null;
}

export interface MessagesPage {
  status?: string;
  chat_id?: number;
  messages: Message[];
  has_more?: boolean;
  next_before_id?: number | null;
}

// ---------- IPC contract ----------

export interface PublicSettings {
  serverDomain: string;
  useSsl: boolean;
  deviceId: string;
  userId: number;
  username: string | null;
  userLanguage: string;
  appTheme: string;
  reactionEmojis: string;
  mediaCacheLimitMb: number;
  isLoggedIn: boolean;
  httpBase: string;
  version: string;
}

export type SettingsPatch = Partial<
  Pick<PublicSettings, 'serverDomain' | 'useSsl' | 'deviceId' | 'userLanguage' | 'appTheme' | 'reactionEmojis' | 'mediaCacheLimitMb'>
>;

export interface SessionInfo {
  token: string;
  userId: number;
  username: string;
  language?: string | null;
}

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path relative to the server root, e.g. "chat/api/chats/". */
  path: string;
  query?: Record<string, string | number | null | undefined>;
  json?: unknown;
  form?: {
    fields: Record<string, string | null | undefined>;
    file?: { field: string; name: string; mime: string; bytes: Uint8Array };
  };
  timeoutMs?: number;
}

export interface ApiResponse {
  status: number;
  ok: boolean;
  data: unknown;
  raw?: string;
  networkError?: string;
}

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string; // data URL
  isScreen: boolean;
}

export interface MediaCacheItem {
  key: string;
  size: number;
  type: string;
  url: string;
  accessed: number;
}

export type WsState = 'disconnected' | 'connecting' | 'connected' | 'error';
export type WsScope = 'chats' | 'room';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WsEventMsg = { type: string } & Record<string, any>;

export interface DtApi {
  settings: {
    get(): Promise<PublicSettings>;
    set(patch: SettingsPatch): Promise<PublicSettings>;
  };
  auth: {
    setSession(s: SessionInfo): Promise<PublicSettings>;
    clear(): Promise<PublicSettings>;
  };
  api(req: ApiRequest): Promise<ApiResponse>;
  ws: {
    connectChats(): Promise<void>;
    enterRoom(chatId: number): Promise<void>;
    leaveRoom(): Promise<void>;
    disconnect(): Promise<void>;
    /** Drop and reopen the sockets (after network change / wake-up). */
    reconnect(): Promise<void>;
    /** Room socket (messages, typing). Returns false when it is not open (caller falls back to HTTP). */
    send(payload: Record<string, unknown>): Promise<boolean>;
    /** Chats socket: call signaling. Returns false when it is not open. */
    sendCall(payload: Record<string, unknown>): Promise<boolean>;
  };
  onWsEvent(cb: (e: WsEventMsg) => void): () => void;
  onWsState(cb: (scope: WsScope, state: WsState) => void): () => void;
  onAuthCleared(cb: () => void): () => void;
  saveFile(url: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  cache: {
    me(): Promise<User | null>;
    setMe(user: User | null): Promise<void>;
    chats(): Promise<Chat[]>;
    saveChats(chats: Chat[]): Promise<void>;
    messages(chatId: number): Promise<Message[]>;
    saveMessages(chatId: number, messages: Message[]): Promise<void>;
    sizes(): Promise<{ data: number; media: number }>;
    clearData(): Promise<void>;
    clearMedia(): Promise<void>;
    listMedia(): Promise<MediaCacheItem[]>;
    deleteMedia(keys: string[]): Promise<void>;
  };
  screen: {
    sources(): Promise<ScreenSource[]>;
    select(id: string | null): Promise<void>;
  };
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    dt: DtApi;
  }
}
