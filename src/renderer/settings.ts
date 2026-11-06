import type { Device, LoginHistoryItem, MediaCacheItem } from '../shared/types';
import * as api from './api';
import { S, nav } from './state';
import { avatar, banner, btn, chip, confirmDialog, field, h, icon, openModal, readFileBytes, setBusy, switchEl, textInput, toast } from './ui';
import { formatLastSeen, parseIsoMillis, setLanguage, t } from './util';

export const THEMES: Record<string, { name: string; accent: string; dark: string; light: string; on: string }> = {
  telegram: { name: 'Telegram', accent: '#4EA8FF', dark: '#16406F', light: '#D3E8FF', on: '#FFFFFF' },
  cyber: { name: 'Cyber', accent: '#00E5FF', dark: '#003844', light: '#97F0FF', on: '#001F28' },
  neon: { name: 'Neon', accent: '#A855F7', dark: '#371E5E', light: '#EADBFF', on: '#1E0038' },
  emerald: { name: 'Emerald', accent: '#10B981', dark: '#064E3B', light: '#A7F3D0', on: '#002818' },
  crimson: { name: 'Crimson', accent: '#F43F5E', dark: '#881337', light: '#FECDD3', on: '#2E000A' },
  amber: { name: 'Amber', accent: '#F59E0B', dark: '#78350F', light: '#FDE68A', on: '#291500' },
};

export function applyThemeVars(name: string): void {
  const th = THEMES[name] ?? THEMES.telegram;
  const s = document.documentElement.style;
  s.setProperty('--accent', th.accent);
  s.setProperty('--accent-dark', th.dark);
  s.setProperty('--accent-light', th.light);
  s.setProperty('--on-accent', th.on);
}

const TABS: [string, string, string][] = [
  ['profile', 'person', 'profile'],
  ['security', 'lock', 'security'],
  ['network', 'dns', 'network'],
  ['personalization', 'palette', 'personalization'],
  ['storage', 'folder', 'storage'],
];

export function openSettings(initialTab = 0, onClose?: () => void): void {
  const loggedIn = S.settings.isLoggedIn;
  const tabs = loggedIn ? TABS : TABS.filter((x) => x[0] === 'network' || x[0] === 'personalization');
  let current = Math.min(initialTab, TABS.length - 1);
  const wanted = TABS[current][0];
  current = Math.max(0, tabs.findIndex((x) => x[0] === wanted));

  const nav_ = h('nav');
  const pane = h('div', { class: 'pane' });
  let close: () => void = () => {};

  const show = (i: number): void => {
    current = i;
    nav_.replaceChildren(
      ...tabs.map((tb, idx) => h('button', { class: idx === i ? 'on' : '', type: 'button', onclick: () => show(idx) }, icon(tb[1], 18), t(tb[2] as any))),
      h('div', { class: 'grow' }),
      btn(t('close'), () => close(), { secondary: true }),
    );
    pane.replaceChildren();
    const key = tabs[i][0];
    if (key === 'profile') profilePane(pane);
    else if (key === 'security') securityPane(pane, () => close());
    else if (key === 'network') networkPane(pane);
    else if (key === 'personalization') personalPane(pane);
    else storagePane(pane);
  };

  close = openModal(h('div', { class: 'settings' }, nav_, pane), { wide: true, onClose });
  show(current);
}

function section(title: string): HTMLElement {
  return h('div', { class: 'section-title' }, title);
}

// ---------------------------------------------------------------- profile

function profilePane(pane: HTMLElement): void {
  const me = S.me;
  const username = textInput({ value: me?.username ?? '' });
  const info = h('textarea', { class: 'input', rows: 3, style: { height: 'auto', padding: '10px 12px' }, value: me?.info ?? '' });
  const dob = textInput({ value: me?.date_of_birth ?? '', placeholder: 'YYYY-MM-DD' });
  let lang = me?.language ?? S.settings.userLanguage ?? 'Russian';
  let avatarFile: { bytes: Uint8Array; name: string; mime: string } | null = null;
  const msg = h('div');
  const langRow = h('div', { class: 'row gap' });
  const renderLang = (): void => {
    const ru = !/^en/i.test(lang);
    langRow.replaceChildren(chip('Русский', ru, () => ((lang = 'Russian'), renderLang())), chip('English', !ru, () => ((lang = 'English'), renderLang())));
  };
  renderLang();

  const avHost = h('div');
  const renderAv = (): void => avHost.replaceChildren(avatar(me?.avatar, me?.username ?? '?', 84));
  renderAv();
  const fileIn = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const avLabel = h('div', { class: 'small muted' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    avatarFile = { bytes: await readFileBytes(f), name: f.name, mime: f.type || 'image/jpeg' };
    avLabel.textContent = t('newAvatar', f.name);
  });

  const save = btn(t('saveProfile'), async () => {
    setBusy(save, true);
    const payload = { username: username.value.trim(), info: info.value, language: lang, date_of_birth: dob.value.trim() || null };
    const r = await api.updateProfile(payload, avatarFile ?? undefined);
    setBusy(save, false);
    if (!r.ok) {
      msg.replaceChildren(banner('error', r.message));
      return;
    }
    const u = (r.data as any).user ?? r.data;
    if (u?.id) S.me = u;
    setLanguage(lang);
    await window.dt.settings.set({ userLanguage: lang });
    S.settings = await window.dt.settings.get();
    msg.replaceChildren(banner('success', t('profileUpdated')));
    nav.rebuild();
  });

  pane.append(
    h('div', { class: 'row gap center-y' }, avHost, h('div', { class: 'col gap-s' }, btn(t('chooseAvatar'), () => fileIn.click(), { secondary: true }), avLabel), fileIn),
    field(t('username'), username),
    field(t('bio'), info),
    field(t('dob'), dob),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('language')), langRow),
    msg,
    save,
  );
}

// ---------------------------------------------------------------- security

function securityPane(pane: HTMLElement, closeAll: () => void): void {
  const msg = h('div');
  const twoFaBox = h('div', { class: 'list-row' });
  const devices = h('div', { class: 'col gap-s' });
  const history = h('div', { class: 'col gap-s' });

  const loadTwoFa = async (): Promise<void> => {
    const r = await api.get2fa();
    const on = r.ok ? !!r.data.two_factor_enabled : false;
    twoFaBox.replaceChildren(
      icon('shield', 22),
      h('div', { class: 'grow' }, h('div', { class: 'strong' }, t('twoFa')), h('div', { class: 'small muted' }, on ? t('twoFaOn') : t('twoFaOff'))),
      switchEl(on, async (v) => {
        const res = await api.set2fa(v);
        if (!res.ok) msg.replaceChildren(banner('error', res.message));
        else msg.replaceChildren();
        void loadTwoFa();
      }),
    );
  };

  const deviceRow = (d: Device): HTMLElement => {
    const isThis = d.device_id === S.settings.deviceId;
    return h(
      'div',
      { class: 'list-row' },
      icon('dns', 20),
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'strong ellipsis' }, d.name || d.device_id, isThis ? ` · ${t('thisDevice')}` : ''),
        h('div', { class: 'small muted' }, [d.device_type, d.trusted ? t('trusted') : null, formatLastSeen(d.last_seen)].filter(Boolean).join(' · ')),
      ),
      isThis
        ? null
        : h('button', {
            class: 'icon-btn danger',
            type: 'button',
            title: t('remove'),
            onclick: async () => {
              const r = await api.deleteDevice(d.device_id);
              if (!r.ok) msg.replaceChildren(banner('error', r.message));
              else void loadDevices();
            },
          }, icon('close', 18)),
    );
  };
  const loadDevices = async (): Promise<void> => {
    const r = await api.getDevices();
    devices.replaceChildren(...(r.ok ? (r.data.devices ?? []).map(deviceRow) : [banner('error', r.message)]));
  };
  const histRow = (x: LoginHistoryItem): HTMLElement => {
    const ms = parseIsoMillis(x.created_at);
    const ok = (x.status ?? '').toLowerCase().includes('success');
    return h(
      'div',
      { class: 'list-row' },
      h('div', { class: 'grow' }, h('div', { class: 'strong' }, [x.ip, x.city, x.country].filter(Boolean).join(' · ') || '—'), h('div', { class: 'small muted' }, [x.device, ms ? new Date(ms).toLocaleString() : null, x.reason].filter(Boolean).join(' · '))),
      h('span', { class: ok ? 'success small' : 'small', style: ok ? {} : { color: 'var(--error)' } }, x.status ?? ''),
    );
  };
  const loadHistory = async (): Promise<void> => {
    const r = await api.getLoginHistory();
    history.replaceChildren(...(r.ok ? (r.data.login_history ?? []).slice(0, 15).map(histRow) : [banner('error', r.message)]));
  };

  const signOut = btn(t('signOut'), async () => {
    if (!(await confirmDialog(t('signOut') + '?', t('signOut')))) return;
    closeAll();
    await api.logoutRequest();
    await window.dt.auth.clear();
    S.me = null;
    S.settings = await window.dt.settings.get();
    nav.signedOut();
  }, { danger: true, icon: 'logout' });

  pane.append(twoFaBox, msg, section(t('devices')), devices, section(t('loginHistory')), history, signOut);
  void loadTwoFa();
  void loadDevices();
  void loadHistory();
}

// ---------------------------------------------------------------- network

function networkPane(pane: HTMLElement): void {
  const st = S.settings;
  const domain = textInput({ value: st.serverDomain });
  let ssl = st.useSsl;
  const tlsHint = h('div', { class: 'small muted' }, ssl ? '' : t('tlsOff'));
  const msg = h('div');

  const save = btn(t('saveConfig'), async () => {
    setBusy(save, true);
    S.settings = await window.dt.settings.set({ serverDomain: domain.value.trim(), useSsl: ssl });
    setBusy(save, false);
    msg.replaceChildren(banner('success', t('saved')));
    nav.rebuild();
  });

  pane.append(
    field(t('serverDomain'), domain),
    h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('div', { class: 'strong' }, t('useTls')), tlsHint), switchEl(ssl, (v) => ((ssl = v), (tlsHint.textContent = v ? '' : t('tlsOff'))))),
    msg,
    save,
  );
}

// ---------------------------------------------------------------- personalization

function personalPane(pane: HTMLElement): void {
  const grid = h('div', { class: 'theme-grid' });
  const render = (): void =>
    grid.replaceChildren(
      ...Object.entries(THEMES).map(([key, th]) =>
        h(
          'div',
          {
            class: 'theme-card' + (S.settings.appTheme === key ? ' on' : ''),
            onclick: async () => {
              S.settings = await window.dt.settings.set({ appTheme: key });
              nav.applyTheme(key);
              render();
            },
          },
          h('div', { class: 'swatch', style: { background: `linear-gradient(135deg, ${th.accent}, ${th.dark})` } }),
          h('span', { class: 'strong' }, th.name),
        ),
      ),
    );
  render();
  const emojis = textInput({ value: S.settings.reactionEmojis });
  emojis.addEventListener('change', async () => {
    S.settings = await window.dt.settings.set({ reactionEmojis: emojis.value });
  });
  pane.append(section(t('theme')), grid, field(t('reactionEmojis'), emojis));
}

// ---------------------------------------------------------------- storage

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  let v = n;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

function storagePane(pane: HTMLElement): void {
  const dataSize = h('div', { class: 'small muted' }, '…');
  const mediaSize = h('div', { class: 'small muted' }, '…');
  const refresh = async (): Promise<void> => {
    const s = await window.dt.cache.sizes();
    dataSize.textContent = fmtBytes(s.data);
    mediaSize.textContent = fmtBytes(s.media);
  };
  const limits: [number, string][] = [[100, '100 MB'], [500, '500 MB'], [1000, '1 GB'], [0, t('unlimited')]];
  const limitRow = h('div', { class: 'row gap', style: { flexWrap: 'wrap' } });
  const renderLimits = (): void =>
    limitRow.replaceChildren(
      ...limits.map(([mb, label]) =>
        chip(label, S.settings.mediaCacheLimitMb === mb, async () => {
          S.settings = await window.dt.settings.set({ mediaCacheLimitMb: mb });
          renderLimits();
          void refresh();
        }),
      ),
    );
  renderLimits();

  pane.append(
    h('div', { class: 'muted' }, t('cacheHint')),
    h('div', { class: 'list-row' }, icon('folder', 20), h('div', { class: 'grow' }, h('div', { class: 'strong' }, t('storageData')), dataSize)),
    btn(t('clearData'), async () => {
      await window.dt.cache.clearData();
      toast(t('dataCleared'), 'success');
      void refresh();
    }, { secondary: true, icon: 'delete' }),
    h('div', { class: 'list-row' }, icon('folder', 20), h('div', { class: 'grow' }, h('div', { class: 'strong' }, t('storageMedia')), mediaSize)),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('mediaLimit')), limitRow),
    h('div', { class: 'row gap', style: { flexWrap: 'wrap' } },
      btn(t('viewCache'), () => openMediaManager(refresh), { secondary: true, icon: 'folder' }),
      btn(t('clearMedia'), async () => {
        await window.dt.cache.clearMedia();
        toast(t('cacheCleared'), 'success');
        void refresh();
      }, { secondary: true, icon: 'delete' }),
    ),
  );
  void refresh();
}

function openMediaManager(onClose?: () => void): void {
  const container = h('div', { class: 'media-manager' });
  const listBox = h('div', { class: 'media-list' });
  const toolbar = h('div', { class: 'media-toolbar' });
  const selected = new Set<string>();
  let items: MediaCacheItem[] = [];
  const boxes = new Map<string, HTMLInputElement>();
  const mediaUrl = (it: MediaCacheItem): string => `dtmedia://k/?key=${encodeURIComponent(it.key)}`;

  const counter = h('span', { class: 'small muted' });
  const toggleBtn = btn('', () => setAll(selected.size !== items.length), { secondary: true });
  const deleteBtn = btn(t('deleteSelected'), () => void deleteSelected(), { danger: true, icon: 'delete' });
  toolbar.append(counter, h('div', { class: 'grow' }), toggleBtn, deleteBtn);

  // Updates only the toolbar and checkbox states: the list is NOT rebuilt, so a click never resets the selection.
  const sync = (): void => {
    counter.textContent = t('selected', String(selected.size));
    const label = toggleBtn.querySelector('span');
    if (label) label.textContent = selected.size === items.length && items.length > 0 ? t('unselectAll') : t('selectAll');
    deleteBtn.disabled = selected.size === 0;
    toolbar.style.display = items.length === 0 ? 'none' : '';
  };

  const setAll = (checked: boolean): void => {
    selected.clear();
    if (checked) items.forEach((it) => selected.add(it.key));
    boxes.forEach((cb, key) => (cb.checked = selected.has(key)));
    sync();
  };

  const preview = (it: MediaCacheItem): void => {
    const src = mediaUrl(it);
    let el: HTMLElement;
    if (it.type.startsWith('image/')) el = h('img', { src, style: { maxWidth: '92vw', maxHeight: '90vh', borderRadius: '8px', display: 'block' } });
    else if (it.type.startsWith('video/')) el = h('video', { src, controls: true, autoplay: true, style: { maxWidth: '92vw', maxHeight: '90vh', borderRadius: '8px', display: 'block' } });
    else if (it.type.startsWith('audio/')) el = h('audio', { src, controls: true, autoplay: true, style: { width: '420px', maxWidth: '90vw' } });
    else return;
    const close = openModal(h('div', { class: 'lightbox' }, el), { bare: true, onClose: () => { if (el instanceof HTMLMediaElement) el.pause(); } });
    void close;
  };

  const build = (): void => {
    boxes.clear();
    if (items.length === 0) {
      listBox.replaceChildren(h('div', { class: 'muted center', style: { padding: '40px' } }, t('noMediaCached')));
      sync();
      return;
    }
    const thumbStyle = { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '4px', background: 'var(--bg-light)', flex: '0 0 auto' };
    listBox.replaceChildren(
      ...items.map((it) => {
        const isImage = it.type.startsWith('image/');
        const isVideo = it.type.startsWith('video/');
        const isAudio = it.type.startsWith('audio/');
        const viewable = isImage || isVideo || isAudio;
        const iconBox = (): HTMLElement =>
          h('div', { class: 'file-icon', style: { ...thumbStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--text2)', flexDirection: 'column', gap: '4px' } },
            icon(isAudio ? 'mic' : 'attach_file', 24),
            h('span', { style: { fontSize: '9px', opacity: '0.7' } }, it.type.split('/')[1]?.toUpperCase().slice(0, 4) || 'FILE'));
        const thumb = h('div', { class: 'media-thumb' + (viewable ? ' viewable' : ''), title: viewable ? t('view') : '', style: { cursor: viewable ? 'zoom-in' : 'default' } });
        if (isImage) {
          const img = h('img', { src: mediaUrl(it), loading: 'lazy', style: thumbStyle });
          img.addEventListener('error', () => thumb.replaceChildren(iconBox()));
          thumb.append(img);
        } else if (isVideo) {
          const v = h('video', { src: mediaUrl(it) + '#t=0.1', preload: 'metadata', muted: true, style: thumbStyle });
          v.addEventListener('error', () => thumb.replaceChildren(iconBox()));
          thumb.append(v);
        } else thumb.append(iconBox());
        if (viewable) thumb.addEventListener('click', () => preview(it));

        const checkbox = h('input', { type: 'checkbox' });
        checkbox.checked = selected.has(it.key);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(it.key);
          else selected.delete(it.key);
          sync();
        });
        boxes.set(it.key, checkbox);

        const row = h('div', { class: 'media-item' },
          checkbox,
          thumb,
          h('div', { class: 'grow' },
            h('div', { class: 'strong ellipsis' }, it.type),
            h('div', { class: 'small muted' }, `${fmtBytes(it.size)} · ${new Date(it.accessed).toLocaleDateString()}`),
          ),
        );
        // clicking the empty part of the row toggles the checkbox (thumbnail opens the preview instead)
        row.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target === checkbox || target.closest('.media-thumb.viewable')) return;
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        });
        return row;
      }),
    );
    sync();
  };

  const load = async (): Promise<void> => {
    items = await window.dt.cache.listMedia();
    const keys = new Set(items.map((i) => i.key));
    for (const k of [...selected]) if (!keys.has(k)) selected.delete(k);
    build();
  };

  async function deleteSelected(): Promise<void> {
    if (selected.size === 0) return;
    const count = selected.size;
    if (!(await confirmDialog(t('confirmDeleteFiles', String(count)), t('delete')))) return;
    setBusy(deleteBtn, true);
    try {
      await window.dt.cache.deleteMedia([...selected]);
    } finally {
      setBusy(deleteBtn, false);
    }
    selected.clear();
    toast(t('filesDeleted', String(count)), 'success');
    await load();
  }

  container.append(toolbar, listBox);
  openModal(container, { wide: true, onClose: () => { onClose?.(); } });
  void load();
}
