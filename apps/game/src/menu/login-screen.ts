import type { AudioEngine } from '../audio/audio-engine.js';
import type { AccountUser } from '../account/account-api.js';
import type { AccountSession } from '../account/account-session.js';
import { GOOGLE_G, WORDMARK, icon } from './icons.js';
import {
  authErrorText,
  localCheck,
  type LoginError,
  type LoginField,
  type LoginView,
} from './login-model.js';
import { keyBadge, mountOverlay } from './overlay-stage.js';

export interface LoginScreenOptions {
  readonly root: HTMLElement;
  readonly account: AccountSession;
  readonly audio?: Pick<AudioEngine, 'play'> | undefined;
  readonly version: string;
  readonly initialEmail?: string | undefined;
  readonly initialView?: 'login' | 'register' | undefined;
  /** Logged in (the session already knows the user); the screen is disposed. */
  onDone(user: AccountUser): void;
  /** „GRAJ OFFLINE”; the screen is disposed. */
  onOffline(): void;
  /** Esc: back to the menu; the screen is disposed. */
  onBack(): void;
}

export interface LoginScreen {
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

type Busy = undefined | 'submit' | 'google';
interface Sent {
  kind: 'confirm' | 'magic' | 'reset';
  email: string;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const isField = (t: EventTarget | null): t is HTMLInputElement => t instanceof HTMLInputElement;

const TITLES: Record<LoginView, string> = {
  login: 'ZALOGUJ SIĘ',
  register: 'ZAŁÓŻ KONTO',
  magic: 'LINK MAGICZNY',
  reset: 'RESET HASŁA',
};
const SUBMIT: Record<LoginView, [string, string]> = {
  login: ['ZALOGUJ', 'LOGOWANIE…'],
  register: ['ZAŁÓŻ KONTO', 'ZAKŁADAM KONTO…'],
  magic: ['WYŚLIJ LINK MAGICZNY', 'WYSYŁAM…'],
  reset: ['WYŚLIJ LINK DO RESETU', 'WYSYŁAM…'],
};

/**
 * Logowanie (mockup login.png): Google, e-mail + hasło + CAPTCHA, Rejestracja, link magiczny,
 * reset hasła and „Graj offline”. Typing never re-renders (values live in the inputs); a render
 * after a request keeps the values and the focused field.
 */
export function createLoginScreen(o: LoginScreenOptions): LoginScreen {
  const overlay = mountOverlay(o.root, 'dzo--login');
  const { stage } = overlay;
  const api = o.account.api;
  let view: LoginView = o.initialView ?? 'login';
  let sent: Sent | undefined;
  let busy: Busy;
  let error: LoginError | undefined;
  let captcha = '';
  let showPassword = false;
  let disposed = false;
  const values = { email: o.initialEmail ?? '', password: '', password2: '' };

  const ui = (): void => o.audio?.play('ui', 'ui-click1');

  function errFor(f: LoginField): string {
    if (!error || error.field !== f) return '';
    const action =
      error.action === 'resend'
        ? ` <button type="button" class="dza-link" data-act="resend">Wyślij ponownie</button>`
        : error.action === 'to-login'
          ? ` <button type="button" class="dza-link" data-act="to-login">Zaloguj się.</button>`
          : '';
    return `<div class="dza-err" role="alert">${esc(error.text)}${action}</div>`;
  }
  const red = (f: LoginField): string =>
    error && (error.field === f || (error.both && (f === 'email' || f === 'password')))
      ? ' dza-field--error'
      : '';
  const dis = busy ? ' disabled' : '';

  function field(
    name: 'email' | 'password' | 'password2',
    ic: string,
    placeholder: string,
    eye = false,
  ): string {
    const type = name === 'email' ? 'email' : showPassword ? 'text' : 'password';
    const auto =
      name === 'email' ? 'email' : view === 'register' ? 'new-password' : 'current-password';
    return `<label class="dza-field${red(name)}">${icon(ic, 15)}<input name="${name}" type="${type}" autocomplete="${auto}" spellcheck="false" placeholder="${placeholder}" value="${esc(values[name])}"${dis}>${eye ? `<button type="button" class="dza-eye" data-act="eye" tabindex="-1" aria-label="${showPassword ? 'Ukryj hasło' : 'Pokaż hasło'}">${icon('eye', 15)}</button>` : ''}</label>${errFor(name)}`;
  }

  function captchaHtml(): string {
    const ok = !!captcha;
    return `<button type="button" class="dza-captcha${ok ? ' dza-captcha--ok' : ''}${error?.field === 'captcha' ? ' dza-captcha--error' : ''}" data-act="captcha" role="checkbox" aria-checked="${ok}"${dis}><span class="dza-captcha-box">${ok ? icon('check', 15) : ''}</span><span class="dza-captcha-text">${ok ? 'Weryfikacja zakończona' : 'Nie jestem robotem'}<em>CAPTCHA · hCaptcha / Turnstile</em></span>${icon('shield', 20)}</button>${errFor('captcha')}`;
  }

  function submitHtml(): string {
    const [label, loading] = SUBMIT[view];
    const b = busy === 'submit';
    return `<button type="button" class="dza-btn dza-btn--pri dza-submit dza-btn--focus" data-act="submit"${dis}>${b ? `<span class="dza-spin"></span>${loading}` : label}</button>${errFor('form')}`;
  }

  function formHtml(): string {
    if (sent) {
      const t =
        sent.kind === 'confirm'
          ? `Wysłaliśmy link na <b>${esc(sent.email)}</b>. Otwórz go, żeby potwierdzić konto, a potem zaloguj się.`
          : sent.kind === 'magic'
            ? `Wysłaliśmy link na <b>${esc(sent.email)}</b>. Link otwiera grę już zalogowaną.`
            : `Wysłaliśmy link do zmiany hasła na <b>${esc(sent.email)}</b>.`;
      return `<div class="dza-sent" role="status">${icon('mail', 16)} <b>Sprawdź pocztę.</b><br>${t}</div>
<button type="button" class="dza-btn dza-btn--sec dza-submit dza-btn--focus" data-act="to-login">WRÓĆ DO LOGOWANIA</button>`;
    }
    const google = `<button type="button" class="dza-btn dza-google" data-act="google"${dis}>${busy === 'google' ? '<span class="dza-spin" style="border-top-color:#e4e6e3"></span>Przekierowuję do Google…' : `${GOOGLE_G(18)} Kontynuuj z Google`}</button>
<div class="dza-or">ALBO E-MAILEM</div>`;
    const email = `<span class="dza-lbl">E-mail</span><div style="margin-top:6px">${field('email', 'mail', 'twoj@email.pl')}</div>`;
    if (view === 'magic' || view === 'reset') {
      const what =
        view === 'magic'
          ? 'Wyślemy Ci link, który zaloguje Cię bez hasła.'
          : 'Wyślemy Ci link do ustawienia nowego hasła.';
      return `<div class="dza-switch" style="text-align:left;margin:16px 0 14px">${what}</div>${email}${captchaHtml()}${submitHtml()}
<button type="button" class="dza-link dza-back" data-act="to-login">← Wróć do logowania</button>`;
    }
    if (view === 'register') {
      return `${google}${email}
<div class="dza-fieldrow"><span class="dza-lbl">Hasło</span><span class="dza-lbl" style="color:#5b6469">min. 8 znaków</span></div>
<div style="margin-top:6px">${field('password', 'lock', '', true)}</div>
<div class="dza-fieldrow"><span class="dza-lbl">Powtórz hasło</span></div>
<div style="margin-top:6px">${field('password2', 'lock', '')}</div>
${captchaHtml()}${submitHtml()}
<div class="dza-switch">Masz już konto? <button type="button" class="dza-link" data-act="tab-login">Zaloguj się</button></div>`;
    }
    return `${google}${email}
<div class="dza-fieldrow"><span class="dza-lbl">Hasło</span><button type="button" class="dza-link" data-act="reset">Nie pamiętasz hasła?</button></div>
<div style="margin-top:6px">${field('password', 'lock', '', true)}</div>
<div class="dza-magic">${icon('link', 13)}<span>Wolisz bez hasła? <button type="button" class="dza-link" data-act="magic">Wyślij link magiczny</button></span></div>
${captchaHtml()}${submitHtml()}
<div class="dza-switch">Nie masz konta? <button type="button" class="dza-link" data-act="tab-register">Załóż konto</button></div>`;
  }

  function render(): void {
    if (disposed) return;
    const active = document.activeElement;
    const focusName = isField(active) && stage.contains(active) ? active.name : undefined;
    const tabs =
      view === 'login' || view === 'register'
        ? `<div class="dza-tabs" role="tablist"><button type="button" class="dza-tab${view === 'login' ? ' dza-tab--on' : ''}" role="tab" aria-selected="${view === 'login'}" data-act="tab-login">Logowanie</button><button type="button" class="dza-tab${view === 'register' ? ' dza-tab--on' : ''}" role="tab" aria-selected="${view === 'register'}" data-act="tab-register">Rejestracja</button></div>`
        : '';
    stage.innerHTML = `<div class="dza-login-left">${WORDMARK}
<div class="dza-tagline"><i></i><span>PRZETRWAJ. NIC WIĘCEJ.</span></div>
<div class="dza-login-copy">Zaloguj się, żeby postacie były zapisane na koncie.<br>Grasz dalej na każdym komputerze, a zapis sprawdza serwer.</div>
<div class="dza-login-points"><span>${icon('cloudOk', 15)} Autozapis raz na dzień gry · „Zapisz i wyjdź”</span><span>${icon('user', 15)} Do 20 żywych postaci · 50 MB na konto</span><span>${icon('grave', 15)} Śmierć jest ostateczna, zostaje nagrobek</span></div></div>
<form class="dzo-panel dza-login-panel" novalidate aria-label="${TITLES[view]}">
<div class="dza-login-head"><span class="dza-title">${TITLES[view]}</span>${tabs}</div>
${formHtml()}
<div class="dza-hsep" style="margin:16px 0 14px"></div>
<button type="button" class="dza-btn dza-btn--sec dza-offline" data-act="offline"${dis}>${icon('browser', 16)}<span>GRAJ OFFLINE</span><em>· zapis w przeglądarce</em></button>
<div class="dza-privacy">${icon('shield', 13)}<span>Przechowujemy tylko e-mail i zapisy postaci (serwery w UE). Konto i dane usuniesz w Ustawieniach → Konto. <span style="color:#9aa3a7;text-decoration:underline">Polityka prywatności</span></span></div>
</form>
<div class="dza-hints" style="left:42px;bottom:28px"><span>${keyBadge('Tab')}następne pole</span><span>${keyBadge('Enter')}${view === 'login' ? 'zaloguj' : view === 'register' ? 'załóż konto' : 'wyślij'}</span><span>${keyBadge('Esc')}wstecz</span></div>
<div class="dza-version">${esc(o.version)}</div>`;
    const target =
      (focusName && stage.querySelector<HTMLInputElement>(`input[name="${focusName}"]`)) ||
      (error && error.field !== 'form' && error.field !== 'captcha'
        ? stage.querySelector<HTMLInputElement>(`input[name="${error.field}"]`)
        : null) ||
      (busy
        ? null
        : sent
          ? stage.querySelector<HTMLElement>('[data-act="to-login"]')
          : stage.querySelector<HTMLInputElement>(
              values.email && view !== 'magic' && view !== 'reset'
                ? 'input[name="password"]'
                : 'input[name="email"]',
            ));
    target?.focus({ preventScroll: true });
  }

  function setView(v: LoginView): void {
    view = v;
    sent = undefined;
    error = undefined;
    values.password = '';
    values.password2 = '';
    ui();
    render();
  }

  async function submit(): Promise<void> {
    if (busy || sent) return;
    const input = { ...values, captcha };
    const bad = localCheck(view, input);
    if (bad) {
      error = bad;
      render();
      return;
    }
    error = undefined;
    busy = 'submit';
    render();
    const email = values.email.trim();
    if (view === 'login') {
      const r = await api.signInWithPassword(email, values.password, captcha);
      if (disposed) return;
      busy = undefined;
      if (r.ok) return done(r.user);
      error = authErrorText(r.code, email, r.retryAfterMin);
    } else {
      const call =
        view === 'register'
          ? api.signUp(email, values.password, captcha)
          : view === 'magic'
            ? api.sendMagicLink(email, captcha)
            : api.sendPasswordReset(email, captcha);
      const r = await call;
      if (disposed) return;
      busy = undefined;
      if (r.ok) {
        sent = { kind: view === 'register' ? 'confirm' : view, email };
      } else error = authErrorText(r.code, email, r.retryAfterMin);
    }
    // A used CAPTCHA token is single-use (hCaptcha / Turnstile).
    if (error) captcha = '';
    render();
  }

  async function google(): Promise<void> {
    if (busy) return;
    busy = 'google';
    error = undefined;
    render();
    const r = await api.signInWithGoogle();
    if (disposed) return;
    busy = undefined;
    if (r.ok) return done(r.user);
    error = authErrorText(r.code, values.email);
    render();
  }

  async function resend(): Promise<void> {
    const email = values.email.trim();
    const r = await api.resendConfirmation(email, captcha || 'resend');
    if (disposed) return;
    if (r.ok) sent = { kind: 'confirm', email };
    else error = authErrorText(r.code, email, r.retryAfterMin);
    render();
  }

  function done(user: AccountUser): void {
    void o.account.signedIn(user);
    dispose();
    o.onDone(user);
  }

  function onClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = t?.dataset.act;
    if (!act || (t as HTMLButtonElement).disabled) return;
    switch (act) {
      case 'tab-login':
      case 'to-login':
        if (act === 'to-login' && error?.action === 'to-login') values.password = '';
        setView('login');
        break;
      case 'tab-register':
        setView('register');
        break;
      case 'magic':
        setView('magic');
        break;
      case 'reset':
        setView('reset');
        break;
      case 'captcha':
        ui();
        // Placeholder until Serwer picks hCaptcha or Turnstile: the provider widget mounts here
        // and hands over its token; the mock accepts any.
        captcha = captcha ? '' : 'mock-captcha-token';
        if (error?.field === 'captcha') error = undefined;
        render();
        break;
      case 'eye':
        showPassword = !showPassword;
        render();
        break;
      case 'submit':
        ui();
        void submit();
        break;
      case 'google':
        ui();
        void google();
        break;
      case 'resend':
        void resend();
        break;
      case 'offline':
        ui();
        o.account.chooseOffline();
        dispose();
        o.onOffline();
        break;
    }
  }

  function onInput(e: Event): void {
    const t = e.target;
    if (!isField(t)) return;
    if (t.name === 'email' || t.name === 'password' || t.name === 'password2') {
      values[t.name] = t.value;
    }
  }

  overlay.el.addEventListener('click', onClick);
  overlay.el.addEventListener('input', onInput);
  overlay.el.addEventListener('submit', (e) => e.preventDefault());
  render();

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    overlay.dispose();
  }

  return {
    onKey(e) {
      if (disposed) return false;
      if (e.code === 'Escape') {
        if (busy) return true;
        if (view === 'magic' || view === 'reset' || sent) setView('login');
        else {
          ui();
          dispose();
          o.onBack();
        }
        return true;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        // Buttons and links handle Enter themselves (native click).
        if (e.target instanceof HTMLButtonElement) return false;
        if (!e.repeat) {
          if (sent) setView('login');
          else void submit();
        }
        return true;
      }
      return false;
    },
    dispose,
  };
}
