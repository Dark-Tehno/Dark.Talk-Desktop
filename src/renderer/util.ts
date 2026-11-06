import type { Chat, Message } from '../shared/types';

// ---------------- i18n ----------------

const D = {
  chats: ['Чаты', 'Chats'],
  settings: ['Настройки', 'Settings'],
  profile: ['Профиль', 'Profile'],
  security: ['Безопасность', 'Security'],
  network: ['Сеть', 'Network'],
  storage: ['Память', 'Storage'],
  personalization: ['Оформление', 'Personalization'],
  writeMessage: ['Написать сообщение...', 'Write a message...'],
  searchChats: ['Поиск чатов или сообщений', 'Search chats or messages'],
  saveProfile: ['Сохранить профиль', 'Save Profile'],
  signOut: ['Выйти из аккаунта', 'Sign Out'],
  newDirect: ['Новый чат', 'New Direct Chat'],
  newGroup: ['Новая группа', 'New Group Chat'],
  bio: ['О себе / Био', 'Bio / About'],
  language: ['Предпочитаемый язык', 'Preferred Language'],
  dob: ['Дата рождения', 'Date of Birth'],
  clearCache: ['Очистить кэш', 'Clear cache'],
  storageData: ['Чаты и сообщения (офлайн)', 'Chats and messages (offline)'],
  storageMedia: ['Фото, голосовые и файлы', 'Photos, voice messages and files'],
  clearData: ['Очистить сохранённые чаты', 'Clear saved chats'],
  clearMedia: ['Очистить медиа-кэш', 'Clear media cache'],
  mediaLimit: ['Лимит медиа-кэша', 'Media cache limit'],
  unlimited: ['Без лимита', 'Unlimited'],
  dataCleared: ['Сохранённые чаты очищены', 'Saved chats cleared'],
  signIn: ['Войти', 'Sign In'],
  register: ['Регистрация', 'Register'],
  createAccount: ['Создать аккаунт', 'Create Account'],
  username: ['Имя пользователя', 'Username'],
  password: ['Пароль', 'Password'],
  email: ['Email', 'Email'],
  usernameOpt: ['Имя пользователя (необязательно)', 'Username (optional)'],
  usernameHint: ['Пусто — будет часть email до @', 'Leave empty to use the email prefix'],
  twoFaTitle: ['Двухфакторная аутентификация', 'Two-Factor Authentication'],
  twoFaText: ['Код подтверждения отправлен на вашу почту.', 'A confirmation code was sent to your email.'],
  code: ['Код', 'Code'],
  verify: ['Подтвердить и войти', 'Verify & Sign In'],
  resend: ['Отправить код снова', 'Resend code'],
  cancel: ['Отмена', 'Cancel'],
  server: ['Сервер', 'Server'],
  tagline: ['Защищённый мессенджер', 'Secure Real-time Messaging'],
  all: ['Все', 'All'],
  direct: ['Личные', 'Direct'],
  groups: ['Группы', 'Groups'],
  unread: ['Непрочитанные', 'Unread'],
  noChats: ['Пока нет чатов', 'No conversations yet'],
  noChatsHint: ['Нажмите на карандаш, чтобы найти пользователя и начать чат.', 'Press the pencil button to find a user and start a chat.'],
  noMatch: ['Ничего не найдено', 'No matching chats found'],
  selectChat: ['Выберите чат, чтобы начать общение', 'Select a chat to start messaging'],
  noMessages: ['Сообщений пока нет. Скажите привет!', 'No messages yet. Say hello!'],
  typing: ['печатает…', 'typing…'],
  online: ['в сети', 'online'],
  offline: ['не в сети', 'offline'],
  lastSeenRecently: ['был(а) недавно', 'last seen recently'],
  lastSeenAt: ['был(а) в {0}', 'last seen at {0}'],
  lastSeenYesterday: ['был(а) вчера в {0}', 'last seen yesterday at {0}'],
  lastSeenOn: ['был(а) {0}', 'last seen {0}'],
  today: ['Сегодня', 'Today'],
  yesterday: ['Вчера', 'Yesterday'],
  members: ['{0} участников', '{0} members'],
  you: ['Вы', 'You'],
  edited: ['изм.', 'edited'],
  messageDeleted: ['Сообщение удалено', 'Message was deleted'],
  replyingTo: ['Ответ для {0}', 'Replying to {0}'],
  editingMessage: ['Редактирование', 'Editing message'],
  reply: ['Ответить', 'Reply'],
  copy: ['Копировать', 'Copy'],
  edit: ['Изменить', 'Edit'],
  delete: ['Удалить', 'Delete'],
  deleteChat: ['Удалить чат', 'Delete chat'],
  leaveGroup: ['Покинуть группу', 'Leave group'],
  voiceMessage: ['Голосовое сообщение', 'Voice message'],
  photo: ['Фото', 'Photo'],
  video: ['Видео', 'Video'],
  file: ['Файл', 'File'],
  recording: ['Идёт запись…', 'Recording…'],
  searchUsers: ['Поиск пользователей', 'Search users'],
  searchUsersHint: ['Введите имя пользователя…', 'Type a username…'],
  startChat: ['Начать чат', 'Start Chat'],
  groupTitle: ['Название группы', 'Group title'],
  description: ['Описание (необязательно)', 'Description (optional)'],
  participants: ['Участники', 'Participants'],
  createGroup: ['Создать группу', 'Create Group'],
  add: ['Добавить', 'Add'],
  addParticipants: ['Добавить участников', 'Add Participants'],
  chatInfo: ['О чате', 'Chat Info'],
  close: ['Закрыть', 'Close'],
  save: ['Сохранить', 'Save'],
  avatarPrivacy: ['Кто видит аватар', 'Avatar visibility'],
  everyone: ['Все', 'Everyone'],
  loggedIn: ['Авторизованные', 'Logged in'],
  nobody: ['Никто', 'Nobody'],
  twoFa: ['Двухфакторная защита', 'Two-factor protection'],
  twoFaOn: ['Включена — при входе нужен код из письма', 'Enabled — email code required on sign in'],
  twoFaOff: ['Выключена — вход только по паролю', 'Disabled — sign in with password only'],
  devices: ['Устройства', 'Devices'],
  thisDevice: ['Это устройство', 'This device'],
  loginHistory: ['Последние входы', 'Recent logins'],
  serverDomain: ['Домен сервера', 'Server domain'],
  useTls: ['Защищённое соединение (HTTPS / WSS)', 'Secure connection (HTTPS / WSS)'],
  tlsOff: ['Без шифрования — только для разработки', 'Unencrypted — development only'],
  saveConfig: ['Сохранить', 'Save config'],
  saved: ['Сохранено, соединения переустановлены', 'Saved, connections re-established'],
  theme: ['Цветовая тема', 'Color theme'],
  reactionEmojis: ['Быстрые реакции (через запятую)', 'Quick reactions (comma separated)'],
  cacheCleared: ['Кэш очищен', 'Cache cleared'],
  cacheHint: ['Последние 50 сообщений каждого чата и скачанные медиа хранятся на этом компьютере, поэтому переписку можно читать без сети. При выходе из аккаунта всё удаляется.', 'The latest 50 messages of every chat and downloaded media are stored on this computer, so you can read your chats offline. Everything is deleted when you sign out.'],
  viewCache: ['Просмотреть кэш', 'View cache'],
  manageMedia: ['Управление медиа', 'Manage media'],
  cachedFiles: ['Сохранённые файлы', 'Cached files'],
  noMediaCached: ['Нет сохранённых файлов', 'No cached files'],
  selected: ['Выбрано: {0}', 'Selected: {0}'],
  deleteSelected: ['Удалить выбранные', 'Delete selected'],
  selectAll: ['Выбрать все', 'Select all'],
  unselectAll: ['Снять выделение', 'Deselect all'],
  filesDeleted: ['Удалено файлов: {0}', 'Deleted {0} file(s)'],
  view: ['Просмотр', 'View'],
  confirmDeleteFiles: ['Удалить выбранные файлы ({0})?', 'Delete {0} selected file(s)?'],
  profileUpdated: ['Профиль обновлён', 'Profile updated'],
  chooseAvatar: ['Выбрать аватар', 'Choose avatar'],
  newAvatar: ['Новый аватар: {0}', 'New avatar: {0}'],
  attach: ['Прикрепить файл', 'Attach file'],
  download: ['Скачать', 'Download'],
  downloaded: ['Сохранено: {0}', 'Saved: {0}'],
  confirmDeleteChat: ['Удалить чат «{0}»?', 'Delete chat "{0}"?'],
  confirmLeave: ['Покинуть группу «{0}»?', 'Leave group "{0}"?'],
  confirmDeleteMsg: ['Удалить сообщение?', 'Delete this message?'],
  micDenied: ['Нет доступа к микрофону', 'Microphone access denied'],
  connecting: ['Подключение…', 'Connecting…'],
  reconnecting: ['Переподключение…', 'Reconnecting…'],
  noConnection: ['Нет соединения', 'Offline'],
  addOne: ['Добавьте хотя бы одного участника', 'Add at least one participant'],
  enterCreds: ['Введите имя пользователя и пароль', 'Enter username and password'],
  emailPassRequired: ['Нужны email и пароль', 'Email and password are required'],
  enterCode: ['Введите корректный код', 'Enter a valid code'],
  newCodeSent: ['Новый код отправлен на почту', 'New code sent to your email'],
  remove: ['Убрать', 'Remove'],
  trusted: ['Доверенное', 'Trusted'],
  admin: ['админ', 'admin'],
  owner: ['владелец', 'owner'],
  loading: ['Загрузка…', 'Loading…'],
  msgSent: ['Отправлено', 'Sent'],
  msgRead: ['Прочитано', 'Read'],
  noInfo: ['Нет дополнительной информации', 'No additional information'],
  sizeLabel: ['Размер', 'Size'],
  yes: ['Да', 'Yes'],
  call: ['Звонок', 'Call'],
  voiceCall: ['Аудиозвонок', 'Voice call'],
  videoCall: ['Видеозвонок', 'Video call'],
  incomingVoice: ['Входящий аудиозвонок', 'Incoming voice call'],
  incomingVideo: ['Входящий видеозвонок', 'Incoming video call'],
  calling: ['Вызов…', 'Calling…'],
  callConnecting: ['Соединение…', 'Connecting…'],
  accept: ['Принять', 'Accept'],
  decline: ['Отклонить', 'Decline'],
  hangUp: ['Завершить', 'Hang up'],
  mute: ['Выключить микрофон', 'Mute'],
  unmute: ['Включить микрофон', 'Unmute'],
  cameraOn: ['Включить камеру', 'Turn camera on'],
  cameraOff: ['Выключить камеру', 'Turn camera off'],
  shareScreen: ['Показать экран', 'Share screen'],
  stopShare: ['Остановить показ', 'Stop sharing'],
  chooseScreen: ['Что показать?', 'What to share?'],
  screens: ['Экраны', 'Screens'],
  windows: ['Окна', 'Windows'],
  remoteMuted: ['Микрофон выключен', 'Muted'],
  remoteSharing: ['показывает экран', 'is sharing screen'],
  noDevices: ['Нет доступа к микрофону или камере', 'No access to microphone or camera'],
  speed: ['Скорость', 'Speed'],
  deletedMessage: ['Удалённое сообщение', 'Deleted message'],
  minimize: ['Свернуть в миниатюру', 'Minimize'],
  expand: ['Развернуть', 'Expand'],
  popOut: ['Отдельное окно', 'Separate window'],
  groupVoiceCall: ['Групповой аудиозвонок', 'Group voice call'],
  groupVideoCall: ['Групповой видеозвонок', 'Group video call'],
  incomingGroupVoice: ['Входящий групповой аудиозвонок', 'Incoming group voice call'],
  incomingGroupVideo: ['Входящий групповой видеозвонок', 'Incoming group video call'],
  callInProgress: ['Идёт звонок', 'Call in progress'],
  joinCall: ['Присоединиться', 'Join'],
  callIsFull: ['Мест нет', 'Full'],
  inCallNow: ['В звонке: {0}', 'In the call: {0}'],
  noOneInCall: ['Пока никого', 'Nobody yet'],
  callingYou: ['{0} звонит', '{0} is calling'],
  waitingOthers: ['Ждём участников…', 'Waiting for others…'],
  tileLost: ['Нет связи', 'No connection'],
  enlarge: ['Увеличить', 'Enlarge'],
  shrink: ['Уменьшить', 'Shrink'],
  sharingShort: ['экран', 'screen'],
} as const;

export type TKey = keyof typeof D;

let langIdx = 0; // 0 = ru, 1 = en

export function isEnglishLanguage(name?: string | null): boolean {
  const n = (name ?? '').trim().toLowerCase();
  const code = n.split(/[-_]/)[0];
  return code === 'en' || n.includes('english') || n.includes('англий');
}

export function setLanguage(name?: string | null): void {
  langIdx = isEnglishLanguage(name) ? 1 : 0;
  document.documentElement.lang = langIdx === 1 ? 'en' : 'ru';
}

let myIdRef = (): number => -1;
export function bindMyId(fn: () => number): void {
  myIdRef = fn;
}
function getMyId(): number {
  return myIdRef();
}

export function t(key: TKey, ...args: (string | number)[]): string {
  let s: string = D[key][langIdx];
  args.forEach((a, i) => {
    s = s.replace(`{${i}}`, String(a));
  });
  return s;
}

export function locale(): string {
  return langIdx === 1 ? 'en' : 'ru';
}

// ---------------- time ----------------

const HAS_TZ = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/;

/** ISO 8601 -> epoch ms. Values without a zone designator are treated as UTC (like the Android client). */
export function parseIsoMillis(iso?: string | null): number | null {
  if (!iso) return null;
  let s = iso.trim().replace(' ', 'T');
  if (s.length < 11) return null;
  if (!HAS_TZ.test(s.slice(10))) s += 'Z';
  s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localDayKey(iso?: string | null): string | null {
  const ms = parseIsoMillis(iso);
  return ms == null ? null : dayKeyOf(ms);
}

export function formatMessageTime(iso?: string | null): string {
  const ms = parseIsoMillis(iso);
  return ms == null ? '' : hhmm(ms);
}

export function formatDayLabel(iso?: string | null): string {
  const ms = parseIsoMillis(iso);
  if (ms == null) return '';
  const now = Date.now();
  const key = dayKeyOf(ms);
  if (key === dayKeyOf(now)) return t('today');
  if (key === dayKeyOf(now - 86_400_000)) return t('yesterday');
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString(locale(), sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatChatListTime(iso?: string | null): string {
  const ms = parseIsoMillis(iso);
  if (ms == null) return '';
  const now = Date.now();
  if (dayKeyOf(ms) === dayKeyOf(now)) return hhmm(ms);
  if (now - ms < 6 * 86_400_000) return new Date(ms).toLocaleDateString(locale(), { weekday: 'short' });
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

export function formatLastSeen(iso?: string | null): string {
  const ms = parseIsoMillis(iso);
  if (ms == null) return t('lastSeenRecently');
  const key = dayKeyOf(ms);
  const now = Date.now();
  if (key === dayKeyOf(now)) return t('lastSeenAt', hhmm(ms));
  if (key === dayKeyOf(now - 86_400_000)) return t('lastSeenYesterday', hhmm(ms));
  return t('lastSeenOn', formatDayLabel(iso));
}

// ---------------- server errors ----------------

function humanizeErrorCode(code: string): string {
  const en = langIdx === 1;
  const map: Record<string, [string, string]> = {
    INVALID_CREDENTIALS: ['Неверное имя пользователя или пароль', 'Invalid username or password'],
    USERNAME_PASSWORD_NOT_PROVIDED: ['Введите имя пользователя и пароль', 'Enter username and password'],
    TWO_FACTOR_EMAIL_NOT_CONFIGURED: ['Для 2FA нужен email в аккаунте', 'Two-factor authentication needs an email on the account'],
    INVALID_OR_EXPIRED_TWO_FACTOR_CODE: ['Код неверный или просрочен', 'The code is invalid or expired'],
    INVALID_OR_EXPIRED_TWO_FACTOR_CHALLENGE: ['Код неверный или просрочен', 'The code is invalid or expired'],
    LANGUAGE_NOT_SUPPORTED: ['Этот язык не поддерживается', 'This language is not supported'],
    USERNAME_NOT_PROVIDED: ['Введите имя пользователя', 'Enter a username'],
    INVALID_PAGINATION: ['Неверные параметры страницы', 'Invalid pagination parameters'],
  };
  const hit = map[code];
  if (hit) return hit[en ? 1 : 0];
  if (/^[A-Z0-9_]+$/.test(code)) {
    const s = code.replace(/_/g, ' ').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return code;
}

/** {"status":"error","message":"CODE"} / {"detail":"..."} / DRF field errors -> readable string. */
export function parseServerError(raw?: string | null): string | null {
  const text = (raw ?? '').trim();
  if (!text.startsWith('{')) return null;
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    const code = String(obj.message || obj.detail || '').trim();
    if (code) return humanizeErrorCode(code);
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'status') continue;
      const msg = Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v);
      if (msg) parts.push(`${k}: ${msg}`);
    }
    return parts.join('\n') || null;
  } catch {
    return null;
  }
}

// ---------------- previews / misc ----------------

const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;

export function attachmentKind(m: Message): 'image' | 'voice' | 'file' | null {
  if (!m.attachment) return null;
  const name = m.attachment_name || m.attachment;
  if (m.message_type === 'voice_message') return 'voice';
  if (m.message_type === 'image' || IMG_EXT.test(name)) return 'image';
  return 'file';
}

export function callEndReasonText(reason?: string | null): string {
  const en = langIdx === 1;
  switch (reason) {
    case 'busy': return en ? 'User is busy' : 'Абонент занят';
    case 'rejected': return en ? 'Call declined' : 'Звонок отклонён';
    case 'timeout': case 'missed': return en ? 'No answer' : 'Нет ответа';
    case 'cancelled': return en ? 'Call cancelled' : 'Звонок отменён';
    case 'answered_elsewhere': return en ? 'Answered on another device' : 'Принят на другом устройстве';
    case 'no_connection': case 'connection_lost': case 'error': case 'disconnected': return en ? 'Connection lost' : 'Соединение потеряно';
    case 'no_permission': return en ? 'No microphone access' : 'Нет доступа к микрофону';
    case 'call_full': return en ? 'The call is full' : 'В звонке нет свободных мест';
    case 'not_in_call': return en ? 'You are not in this call' : 'Вы не в этом звонке';
    case 'declined_elsewhere': return en ? 'Declined on another device' : 'Отклонён на другом устройстве';
    case 'group_calls_unsupported': return en ? 'Group calls are not supported' : 'Групповые звонки не поддерживаются';
    case 'chat_not_found': case 'unavailable': return en ? 'User unavailable' : 'Абонент недоступен';
    case 'already_in_call': return en ? 'You are already in a call' : 'Вы уже в звонке';
    default: return en ? 'Call ended' : 'Звонок завершён';
  }
}

/** Text of a system "call" message (metadata.call), or null when the message is not a call record. */
export function describeCallMessage(m: Message, myId: number): string | null {
  const call = (m.metadata as Record<string, any> | null | undefined)?.call;
  if (!call || typeof call.status !== 'string') return null;
  const en = langIdx === 1;
  const video = call.media === 'video';
  const dur = Math.max(0, Number(call.duration) || 0);
  if (call.group) {
    // group call record: {group: true, participants: [id...], duration, status, media?}
    const kind = en
      ? video ? 'Group video call' : call.media === 'audio' ? 'Group voice call' : 'Group call'
      : video ? 'Групповой видеозвонок' : call.media === 'audio' ? 'Групповой аудиозвонок' : 'Групповой звонок';
    if (call.status === 'ended') return `${kind} · ${Math.floor(dur / 60)}:${pad(dur % 60)}`;
    if (Number(call.caller_id) === myId) return en ? `${kind}: no answer` : `${kind}: нет ответа`;
    return en ? `Missed ${kind.toLowerCase()}` : `Пропущенный ${kind.toLowerCase()}`;
  }
  const kind = en ? (video ? 'Video call' : 'Voice call') : video ? 'Видеозвонок' : 'Аудиозвонок';
  if (call.status === 'ended') return `${kind} · ${Math.floor(dur / 60)}:${pad(dur % 60)}`;
  if (call.status === 'rejected') return en ? `${kind} declined` : `${kind} отклонён`;
  if (Number(call.caller_id) === myId) return en ? `${kind}: no answer` : `${kind}: нет ответа`;
  return en ? `Missed ${kind.toLowerCase()}` : `Пропущенный ${kind.toLowerCase()}`;
}

export function messagePreview(m: Message): string {
  if (m.is_deleted) return t('messageDeleted');
  const callText = describeCallMessage(m, getMyId());
  if (callText) return `📞 ${callText}`;
  if (m.text && m.text.trim()) return m.text;
  switch (attachmentKind(m)) {
    case 'voice':
      return `🎙 ${t('voiceMessage')}`;
    case 'image':
      return `📷 ${t('photo')}`;
    case 'file':
      return `📁 ${m.attachment_name || t('file')}`;
    default:
      return '';
  }
}

export function chatTitle(chat: Chat, myId: number): string {
  const other = chat.participants?.find((p) => p.user?.id !== myId)?.user;
  return chat.chat_type === 'group' ? chat.title || `Group #${chat.id}` : other?.username || chat.title || `Chat #${chat.id}`;
}

export function chatPreview(chat: Chat, myId: number): string {
  const isGroup = chat.chat_type === 'group';
  const fallback = chat.description?.trim() || (isGroup ? '' : '');
  const msg = chat.last_message;
  if (!msg) return fallback;
  let prefix = '';
  if (msg.sender?.id != null && msg.sender.id === myId) prefix = `${t('you')}: `;
  else if (isGroup && msg.sender?.username) prefix = `${msg.sender.username}: `;
  if (msg.is_deleted) return t('messageDeleted');
  const body = messagePreview(msg);
  return body ? prefix + body : fallback;
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const g = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** g).toFixed(1)} ${units[g]}`;
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let id: number | undefined;
  return (...a: A) => {
    window.clearTimeout(id);
    id = window.setTimeout(() => fn(...a), ms);
  };
}
