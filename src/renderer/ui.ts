import type { User } from '../shared/types';
import { t } from './util';

export type Child = Node | string | number | null | undefined | false;

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

/** Tiny hyperscript: h('div', {class:'x', onclick: fn}, child, 'text'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, any> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el) (el as any)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

// ---------------- icons (Material paths) ----------------

const ICONS: Record<string, string> = {
  call: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  call_end: 'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 01-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z',
  videocam: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
  videocam_off: 'M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z',
  mic_off: 'M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z',
  screen_share: 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zm-7-3.53v-2.19c-2.78 0-4.61.85-6 2.72.56-2.67 2.11-5.33 6-5.87V7l4 3.73-4 3.74z',
  play: 'M8 5v14l11-7z',
  pip: 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
  open_in_new: 'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  mic: 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  attach: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  settings:
    'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  check: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  done_all: 'M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z',
  info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  person_add: 'M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  group: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  file: 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  logout: 'M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  palette: 'M12 3a9 9 0 000 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
  dns: 'M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
};

export function icon(name: string, size = 20): HTMLElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.style.width = span.style.height = `${size}px`;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${ICONS[name] ?? ICONS.info}"/></svg>`;
  return span;
}

// ---------------- media / avatar ----------------

/** Authenticated media is served by the main process through the dtmedia:// protocol. */
export function mediaSrc(raw?: string | null): string {
  return raw ? `dtmedia://m/?u=${encodeURIComponent(raw)}` : '';
}

const PALETTES: [string, string][] = [
  ['#FF8A8A', '#E5486B'],
  ['#FFB454', '#E67E22'],
  ['#B388FF', '#7C4DFF'],
  ['#5EE6A8', '#1FAF7A'],
  ['#4FD8FF', '#1E9BD7'],
  ['#6FB7FF', '#3A74E0'],
  ['#FF8FD0', '#D6459A'],
];

export function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function nameColor(name: string): string {
  return PALETTES[hashCode(name) % PALETTES.length][0];
}

export function avatar(url: string | null | undefined, name: string, size = 44, online?: boolean | null): HTMLElement {
  const [c1, c2] = PALETTES[hashCode(name) % PALETTES.length];
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const root = h('div', { class: 'avatar', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px` } });
  const fallback = h('div', { class: 'avatar-fb', style: { background: `linear-gradient(135deg, ${c1}, ${c2})` } }, initial);
  root.append(fallback);
  if (url) {
    const img = h('img', { class: 'avatar-img', src: mediaSrc(url), alt: '', draggable: false });
    img.addEventListener('error', () => img.remove());
    root.append(img);
  }
  if (online) root.append(h('span', { class: 'online-dot', style: { width: `${size * 0.28}px`, height: `${size * 0.28}px` } }));
  return root;
}

export function userRow(u: User, selected: boolean, onClick: () => void): HTMLElement {
  return h(
    'div',
    { class: 'user-row' + (selected ? ' selected' : ''), onclick: onClick },
    avatar(u.avatar, u.username, 36, u.is_online),
    h('div', { class: 'grow' }, h('div', { class: 'strong' }, u.username), u.info ? h('div', { class: 'muted small ellipsis' }, u.info) : null),
    icon(selected ? 'check' : 'person_add', 18),
  );
}

// ---------------- controls ----------------

export function btn(label: string, onClick: (e: MouseEvent) => void, opts: { secondary?: boolean; danger?: boolean; icon?: string; disabled?: boolean; testid?: string } = {}): HTMLButtonElement {
  const b = h(
    'button',
    { class: 'btn' + (opts.secondary ? ' secondary' : '') + (opts.danger ? ' danger' : ''), type: 'button', disabled: opts.disabled, onclick: onClick },
    opts.icon ? icon(opts.icon, 18) : null,
    h('span', null, label),
  );
  return b;
}

export function setBusy(b: HTMLButtonElement, busy: boolean): void {
  b.disabled = busy;
  b.classList.toggle('busy', busy);
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'muted small' }, hint) : null);
}

export function textInput(opts: { value?: string; placeholder?: string; type?: string; maxLength?: number; onInput?: (v: string) => void } = {}): HTMLInputElement {
  const i = h('input', { class: 'input', type: opts.type ?? 'text', value: opts.value ?? '', placeholder: opts.placeholder ?? '', maxLength: opts.maxLength, spellcheck: false });
  if (opts.onInput) i.addEventListener('input', () => opts.onInput!(i.value));
  return i;
}

export function chip(label: string, selected: boolean, onClick: () => void): HTMLElement {
  return h('button', { class: 'chip' + (selected ? ' selected' : ''), type: 'button', onclick: onClick }, label);
}

export function switchEl(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'slider' }));
}

export function banner(kind: 'error' | 'success' | 'info', text: string): HTMLElement {
  return h('div', { class: `notice ${kind}` }, text);
}

// ---------------- toast / modal / menu ----------------

export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: `toast ${kind}` }, message);
  host.append(el);
  window.setTimeout(() => el.classList.add('hide'), 3200);
  window.setTimeout(() => el.remove(), 3700);
}

export function openModal(content: HTMLElement, opts: { wide?: boolean; onClose?: () => void; bare?: boolean } = {}): () => void {
  const overlay = h('div', { class: 'modal-overlay' });
  const box = h('div', { class: opts.bare ? 'modal-bare' : 'modal glass' + (opts.wide ? ' wide' : '') }, content);
  overlay.append(box);
  let closed = false;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // only the topmost modal reacts, so closing a preview doesn't close the dialog under it
      const all = document.querySelectorAll('.modal-overlay');
      if (all[all.length - 1] !== overlay) return;
      e.stopPropagation();
      close();
    }
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    opts.onClose?.();
  };
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  return close;
}

export function confirmDialog(message: string, okLabel: string, danger = true): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    let close: () => void = () => {};
    const content = h(
      'div',
      { class: 'dialog' },
      h('div', { class: 'dialog-title' }, message),
      h(
        'div',
        { class: 'row end gap' },
        btn(t('cancel'), () => close(), { secondary: true }),
        btn(okLabel, () => {
          result = true;
          close();
        }, { danger }),
      ),
    );
    close = openModal(content, { onClose: () => resolve(result) });
  });
}

export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

export function contextMenu(x: number, y: number, items: MenuItem[], top?: HTMLElement): void {
  document.querySelectorAll('.ctx-menu').forEach((n) => n.remove());
  const menu = h('div', { class: 'ctx-menu glass' });
  if (top) menu.append(top);
  for (const it of items) {
    menu.append(
      h(
        'button',
        {
          class: 'ctx-item' + (it.danger ? ' danger' : ''),
          type: 'button',
          onclick: () => {
            dismiss();
            it.onClick();
          },
        },
        it.icon ? icon(it.icon, 18) : null,
        h('span', null, it.label),
      ),
    );
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
  const dismiss = (): void => {
    menu.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', dismiss);
  };
  const onDown = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) dismiss();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismiss();
  };
  window.setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', dismiss);
  });
}

/** Text with clickable http(s) links (nodes only – no innerHTML, so message text can't inject markup). */
export function linkify(text: string): Node[] {
  const out: Node[] = [];
  const re = /https?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(document.createTextNode(text.slice(last, idx)));
    let url = m[0];
    let trail = '';
    while (/[).,;:!?]$/.test(url)) {
      trail = url.slice(-1) + trail;
      url = url.slice(0, -1);
    }
    out.push(h('a', { href: url, target: '_blank', rel: 'noreferrer noopener', class: 'link' }, url));
    if (trail) out.push(document.createTextNode(trail));
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

export function readFileBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}
