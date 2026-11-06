import type {
  ApiRequest,
  AuthResponse,
  ActiveCallInfo,
  Chat,
  Device,
  LoginHistoryItem,
  Message,
  MessagesPage,
  Reaction,
  User,
} from '../shared/types';
import { S } from './state';
import { parseServerError } from './util';

export type Result<T> = { ok: true; data: T; status: number } | { ok: false; message: string; status: number };

export async function call<T = any>(req: ApiRequest, fallback: string): Promise<Result<T>> {
  const r = await window.dt.api(req);
  if (r.networkError) return { ok: false, message: r.networkError, status: 0 };
  if (r.ok) return { ok: true, data: r.data as T, status: r.status };
  return { ok: false, message: parseServerError(r.raw) ?? `${fallback}: ${r.status}`, status: r.status };
}

const A = 'account/api/';
const C = 'chat/api/';

// ---------------- auth ----------------

export const login = (username: string, password: string) =>
  call<AuthResponse>({ method: 'POST', path: `${A}auth/login/`, json: { username, password, device_id: S.settings.deviceId } }, 'Login failed');

export const register = (p: { email: string; password: string; username?: string; language: string; dob?: string }) =>
  call<AuthResponse>(
    {
      method: 'POST',
      path: `${A}auth/register/`,
      json: { email: p.email, password: p.password, username: p.username || undefined, language: p.language, date_of_birth: p.dob || undefined, device_id: S.settings.deviceId },
    },
    'Registration failed',
  );

export const verify2fa = (challengeId: string, code: string) =>
  call<AuthResponse>({ method: 'POST', path: `${A}auth/2fa/verify/`, json: { challenge_id: challengeId, code, device_id: S.settings.deviceId } }, '2FA verification failed');

export const resend2fa = (challengeId: string) =>
  call<AuthResponse>({ method: 'POST', path: `${A}auth/2fa/resend/`, json: { challenge_id: challengeId } }, 'Failed to resend code');

export const logoutRequest = () =>
  call<unknown>({ method: 'POST', path: `${A}auth/logout/`, json: { device_id: S.settings.deviceId } }, 'Logout failed');

/** Stores the token in the main process (encrypted) and opens the chats socket. */
export async function startSession(auth: AuthResponse): Promise<void> {
  if (!auth.token || !auth.user) return;
  S.settings = await window.dt.auth.setSession({
    token: auth.token,
    userId: auth.user.id,
    username: auth.user.username,
    language: auth.user.language,
  });
  S.me = auth.user;
}

// ---------------- profile / security ----------------

export const getProfile = () => call<{ user: User }>({ method: 'GET', path: `${A}profile/` }, 'Failed to load profile');

export function updateProfile(
  p: { username?: string; info?: string; language?: string; date_of_birth?: string | null; avatar_access?: string },
  avatar?: { bytes: Uint8Array; name: string; mime: string },
) {
  if (avatar) {
    return call<{ user: User }>(
      {
        method: 'PATCH',
        path: `${A}profile/`,
        form: {
          fields: { username: p.username, info: p.info, language: p.language, date_of_birth: p.date_of_birth, avatar_access: p.avatar_access },
          file: { field: 'avatar', name: avatar.name, mime: avatar.mime, bytes: avatar.bytes },
        },
      },
      'Failed to update profile',
    );
  }
  return call<{ user: User }>({ method: 'PATCH', path: `${A}profile/`, json: p }, 'Failed to update profile');
}

export const get2fa = () => call<{ two_factor_enabled: boolean }>({ method: 'GET', path: `${A}2fa/` }, 'Failed to load 2FA');
export const set2fa = (enabled: boolean) => call<{ two_factor_enabled: boolean }>({ method: 'PATCH', path: `${A}2fa/`, json: { enabled } }, 'Failed to change 2FA');
export const getDevices = () => call<{ devices: Device[] }>({ method: 'GET', path: `${A}devices/` }, 'Failed to load devices');
export const deleteDevice = (deviceId: string) => call<unknown>({ method: 'DELETE', path: `${A}devices/${encodeURIComponent(deviceId)}/` }, 'Failed to remove device');
export const getLoginHistory = () => call<{ login_history: LoginHistoryItem[] }>({ method: 'GET', path: `${A}login-history/` }, 'Failed to load history');
export const searchUsers = (username: string) => call<{ users: User[] }>({ method: 'GET', path: `${A}users/search/`, query: { username } }, 'Search failed');
export const getIceServers = () => call<{ ice_servers?: any[]; iceServers?: any[] }>({ method: 'GET', path: 'call/api/ice-servers/' }, 'ICE servers');
export const getActiveCall = (chatId: number) =>
  call<ActiveCallInfo>({ method: 'GET', path: 'call/api/active/', query: { chat_id: chatId } }, 'Active call');

// ---------------- chats ----------------

export async function getChats(): Promise<Result<Chat[]>> {
  const r = await call<{ chats: Chat[] }>({ method: 'GET', path: `${C}chats/` }, 'Failed to load chats');
  if (!r.ok) return r;
  const chats = r.data.chats ?? [];
  // List responses may lack last_message – fetch the newest one (max 6 requests in parallel, like Android).
  const need = chats.filter((c) => !c.last_message && c.last_message_id);
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < need.length) {
      const c = need[i++];
      const m = await getMessages(c.id, 1);
      if (m.ok) c.last_message = m.data.messages[m.data.messages.length - 1] ?? null;
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, need.length) }, worker));
  return { ok: true, data: chats, status: r.status };
}

export const createDirectChat = (participantName: string) =>
  call<{ chat_id: number }>({ method: 'POST', path: `${C}chats/create/`, json: { chat_type: 'direct', participant_name: participantName.trim() } }, 'Failed to create chat');

export const createGroupChat = (names: string, title?: string, description?: string) =>
  call<{ chat_id: number }>(
    { method: 'POST', path: `${C}chats/create/`, json: { chat_type: 'group', participant_names: names, title: title || undefined, description: description || undefined } },
    'Failed to create group',
  );

export const getChatDetails = (id: number) => call<Chat>({ method: 'GET', path: `${C}chats/${id}/` }, 'Failed to load chat');
export const deleteChat = (id: number) => call<unknown>({ method: 'DELETE', path: `${C}chats/${id}/` }, 'Failed to delete chat');
export const addParticipants = (id: number, usernames: string[]) => call<unknown>({ method: 'POST', path: `${C}chats/${id}/participants/`, json: { usernames } }, 'Failed to add participants');
export const leaveOrRemove = (chatId: number, userId: number) => call<unknown>({ method: 'DELETE', path: `${C}chats/${chatId}/participants/${userId}/` }, 'Failed to remove participant');

// ---------------- messages ----------------

export const getMessages = (chatId: number, limit = 50, beforeId?: number | null) =>
  call<MessagesPage>({ method: 'GET', path: `${C}chats/${chatId}/messages/`, query: { limit, before_id: beforeId ?? undefined } }, 'Failed to load messages');

export const markChatRead = (chatId: number, lastMessageId?: number | null) =>
  call<unknown>({ method: 'POST', path: `${C}chats/${chatId}/read/`, json: lastMessageId ? { last_message_id: lastMessageId } : {} }, 'Failed to mark read');

export const markMessageRead = (messageId: number) => call<unknown>({ method: 'POST', path: `${C}messages/read/${messageId}/` }, 'Failed to mark read');

export const createTextMessage = (chatId: number, text: string, replyTo?: number | null, clientMessageId?: string) =>
  call<{ chat_id: number; message_id: number }>(
    { method: 'POST', path: `${C}messages/create/`, json: { chat_id: chatId, text, message_type: 'text', reply_to: replyTo ?? undefined, client_message_id: clientMessageId } },
    'Failed to send message',
  );

export const createAttachmentMessage = (chatId: number, file: { bytes: Uint8Array; name: string; mime: string }, messageType: string, text?: string, replyTo?: number | null) =>
  call<{ chat_id: number; message_id: number }>(
    {
      method: 'POST',
      path: `${C}messages/create/`,
      form: {
        fields: { chat_id: String(chatId), text: text || undefined, message_type: messageType, reply_to: replyTo != null ? String(replyTo) : undefined },
        file: { field: 'attachment', name: file.name, mime: file.mime, bytes: file.bytes },
      },
    },
    'Failed to upload attachment',
  );

export const editMessageHttp = (id: number, text: string) => call<Message>({ method: 'PATCH', path: `${C}messages/${id}/`, json: { text } }, 'Failed to edit message');
export const deleteMessageHttp = (id: number) => call<unknown>({ method: 'DELETE', path: `${C}messages/${id}/` }, 'Failed to delete message');

export const addReaction = (id: number, emoji: string) =>
  call<{ message_reaction?: Reaction }>({ method: 'POST', path: `${C}messages/reaction/${id}/`, json: { emoji } }, 'Failed to add reaction');
export const removeReaction = (id: number, emoji: string) => call<unknown>({ method: 'DELETE', path: `${C}messages/reaction/${id}/`, query: { emoji } }, 'Failed to remove reaction');
