import type { PublicSettings, User } from '../shared/types';
import { bindMyId } from './util';

/** Shared app state. `settings` is filled in app.ts before any view is created. */
export const S = {
  settings: null as unknown as PublicSettings,
  me: null as User | null,
};

export function myId(): number {
  return S.settings.userId;
}

/** Navigation hooks, assigned by app.ts so views don't import each other. */
export const nav = {
  openChat: (_chatId: number, _title: string): void => {},
  closeRoom: (): void => {},
  reloadChats: (): void => {},
  openSettings: (_tab?: number): void => {},
  rebuild: (): void => {},
  applyTheme: (_name: string): void => {},
  signedOut: (): void => {},
};

bindMyId(myId);
