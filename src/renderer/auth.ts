import * as api from './api';
import { S, nav } from './state';
import { banner, btn, chip, field, h, icon, openModal, setBusy, textInput } from './ui';
import { setLanguage, t } from './util';

export function buildAuthView(onSuccess: () => void): HTMLElement {
  let mode: 'login' | 'register' = 'login';
  let regLanguage = 'Russian';
  let errorText: string | null = null;
  const root = h('div', { class: 'auth-wrap' });

  const finish = async (res: Awaited<ReturnType<typeof api.login>>, twoFaAllowed: boolean): Promise<boolean> => {
    if (!res.ok) {
      errorText = res.message;
      render();
      return false;
    }
    const a = res.data;
    if (twoFaAllowed && (a.status === 'two_factor_required' || res.status === 202) && a.challenge_id) {
      openTwoFa(a.challenge_id);
      return false;
    }
    if (!a.token) {
      errorText = a.detail || 'No token received';
      render();
      return false;
    }
    await api.startSession(a);
    if (a.user?.language) {
      setLanguage(a.user.language);
      await window.dt.settings.set({ userLanguage: a.user.language });
      S.settings = await window.dt.settings.get();
    }
    onSuccess();
    return true;
  };

  function openTwoFa(initialChallenge: string): void {
    let challenge = initialChallenge;
    const msg = h('div');
    const code = textInput({ placeholder: '123456', maxLength: 6 });
    code.inputMode = 'numeric';
    code.autocomplete = 'one-time-code';
    let close: () => void = () => {};
    const verify = btn(t('verify'), async () => {
      if (code.value.trim().length < 4) {
        msg.replaceChildren(banner('error', t('enterCode')));
        return;
      }
      setBusy(verify, true);
      const r = await api.verify2fa(challenge, code.value.trim());
      setBusy(verify, false);
      if (!r.ok) {
        msg.replaceChildren(banner('error', r.message));
        return;
      }
      if (r.data.token) {
        await api.startSession(r.data);
        close();
        onSuccess();
      }
    });
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') verify.click();
    });
    const resend = btn(t('resend'), async () => {
      const r = await api.resend2fa(challenge);
      if (r.ok) {
        challenge = r.data.challenge_id || challenge;
        msg.replaceChildren(banner('success', t('newCodeSent')));
      } else msg.replaceChildren(banner('error', r.message));
    }, { secondary: true });

    close = openModal(
      h(
        'div',
        { class: 'dialog center' },
        h('div', { class: 'big-icon' }, icon('shield', 30)),
        h('div', { class: 'dialog-title' }, t('twoFaTitle')),
        h('div', { class: 'muted' }, t('twoFaText')),
        msg,
        field(t('code'), code),
        verify,
        h('div', { class: 'row between' }, resend, btn(t('cancel'), () => close(), { secondary: true })),
      ),
    );
    setTimeout(() => code.focus(), 50);
  }

  function render(): void {
    const loginUser = textInput({ placeholder: t('username') });
    const loginPass = textInput({ type: 'password', placeholder: t('password') });
    const regEmail = textInput({ type: 'email', placeholder: 'user@example.com' });
    const regPass = textInput({ type: 'password', placeholder: t('password') });
    const regUser = textInput({ placeholder: t('usernameHint') });
    const regDob = textInput({ placeholder: 'YYYY-MM-DD' });

    const submitLogin = btn(t('signIn'), async () => {
      if (!loginUser.value.trim() || !loginPass.value) {
        errorText = t('enterCreds');
        render();
        return;
      }
      setBusy(submitLogin, true);
      const res = await api.login(loginUser.value.trim(), loginPass.value);
      setBusy(submitLogin, false);
      await finish(res, true);
    });
    const submitReg = btn(t('createAccount'), async () => {
      if (!regEmail.value.trim() || !regPass.value) {
        errorText = t('emailPassRequired');
        render();
        return;
      }
      setBusy(submitReg, true);
      const res = await api.register({
        email: regEmail.value.trim(),
        password: regPass.value,
        username: regUser.value.trim() || undefined,
        language: regLanguage,
        dob: regDob.value.trim() || undefined,
      });
      setBusy(submitReg, false);
      await finish(res, false);
    });
    for (const [el, b] of [
      [loginUser, submitLogin],
      [loginPass, submitLogin],
      [regEmail, submitReg],
      [regPass, submitReg],
      [regUser, submitReg],
      [regDob, submitReg],
    ] as const) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') b.click();
      });
    }

    const tabs = h(
      'div',
      { class: 'seg' },
      h('button', { class: mode === 'login' ? 'on' : '', type: 'button', onclick: () => ((mode = 'login'), (errorText = null), render()) }, t('signIn')),
      h('button', { class: mode === 'register' ? 'on' : '', type: 'button', onclick: () => ((mode = 'register'), (errorText = null), render()) }, t('register')),
    );

    const form =
      mode === 'login'
        ? h('div', { class: 'col gap' }, field(t('username'), loginUser), field(t('password'), loginPass), submitLogin)
        : h(
            'div',
            { class: 'col gap' },
            field(`${t('email')} *`, regEmail),
            field(`${t('password')} *`, regPass),
            field(t('usernameOpt'), regUser),
            h('div', { class: 'row gap center-y' }, h('span', { class: 'muted' }, `${t('language')}:`), chip('Русский', regLanguage === 'Russian', () => ((regLanguage = 'Russian'), setLanguage('Russian'), render())), chip('English', regLanguage === 'English', () => ((regLanguage = 'English'), setLanguage('English'), render()))),
            field(`${t('dob')} (${'YYYY-MM-DD'})`, regDob),
            submitReg,
          );

    const card = h(
      'div',
      { class: 'auth-card glass' },
      h('div', { class: 'logo' }, 'D'),
      h('div', { class: 'brand' }, 'Dark.Talk'),
      h('div', { class: 'muted' }, t('tagline')),
      h('button', { class: 'server-badge', type: 'button', onclick: () => nav.openSettings(2) }, icon('dns', 14), h('span', null, `${t('server')}: ${S.settings.serverDomain}`)),
      tabs,
      errorText ? banner('error', errorText) : null,
      form,
    );
    root.replaceChildren(card);
    (mode === 'login' ? loginUser : regEmail).focus();
  }

  render();
  return root;
}
