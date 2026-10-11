// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { AccountSession } from '../account/account-session.js';
import { createMockAccountApi, MOCK_EMAIL } from '../account/mock-api.js';
import type { AccountExport } from '@deadzone/protocol';
import {
  createAccountPanel,
  emailMatches,
  exportFileName,
  exportRetryMessage,
} from './account-panel.js';
import { createCloudCharactersScreen } from './cloud-characters-screen.js';
import { createLoginScreen } from './login-screen.js';
import { compareRows, overwriteLoss, showSaveConflict, toastMeta } from './session-conflict.js';
import { settingsTabs, stepTab } from './settings-tabs.js';
import { shouldShowMenu } from './boot-menu.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const key = (code: string): KeyboardEvent => new KeyboardEvent('keydown', { code });
const host = (): HTMLElement => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
};
const session = (
  signedInAs?: 'google' | 'email',
  o: { failList?: boolean; now?: () => number } = {},
) => new AccountSession({ api: createMockAccountApi({ latencyMs: 0, signedInAs, ...o }) });
const type = (root: HTMLElement, name: string, value: string): void => {
  const i = root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  i.value = value;
  i.dispatchEvent(new Event('input', { bubbles: true }));
};
const check = (root: HTMLElement): void => {
  const c = root.querySelector<HTMLElement>('[data-act="captcha"]')!;
  if (c.getAttribute('aria-checked') !== 'true') c.click();
};
const click = (root: HTMLElement, act: string): void =>
  root.querySelector<HTMLElement>(`[data-act="${act}"]`)!.click();

describe('Logowanie', () => {
  function setup() {
    const root = host();
    const account = session();
    const on = { done: vi.fn(), offline: vi.fn(), back: vi.fn() };
    const screen = createLoginScreen({
      root,
      account,
      version: 'v',
      onDone: on.done,
      onOffline: on.offline,
      onBack: on.back,
    });
    return { root, account, on, screen };
  }

  it('asks for the CAPTCHA, shows a wrong password, then logs in', async () => {
    const { root, account, on } = setup();
    type(root, 'email', MOCK_EMAIL);
    type(root, 'password', 'zle');
    click(root, 'submit');
    expect(root.querySelector('.dza-err')?.textContent).toBe('Potwierdź, że nie jesteś robotem.');
    click(root, 'captcha');
    click(root, 'submit');
    await flush();
    expect(root.querySelector('.dza-err')?.textContent).toBe('Nieprawidłowy e-mail lub hasło.');
    expect(root.querySelectorAll('.dza-field--error')).toHaveLength(2);
    // The used CAPTCHA token is dropped after a failed attempt.
    expect(root.querySelector('[data-act="captcha"]')?.getAttribute('aria-checked')).toBe('false');
    type(root, 'password', 'dobrehaslo');
    click(root, 'captcha');
    click(root, 'submit');
    await flush();
    expect(on.done).toHaveBeenCalled();
    expect(account.user?.email).toBe(MOCK_EMAIL);
  });

  it('Rejestracja checks the password length; link magiczny → „Sprawdź pocztę”', async () => {
    const { root } = setup();
    click(root, 'tab-register');
    type(root, 'email', 'nowy@x.pl');
    type(root, 'password', 'krotkie');
    click(root, 'captcha');
    click(root, 'submit');
    expect(root.querySelector('.dza-err')?.textContent).toBe(
      'Hasło musi mieć co najmniej 8 znaków.',
    );
    click(root, 'tab-login');
    click(root, 'magic');
    type(root, 'email', 'nowy@x.pl');
    check(root);
    click(root, 'submit');
    await flush();
    expect(root.querySelector('.dza-sent')?.textContent).toContain('Wysłaliśmy link na nowy@x.pl');
  });

  it('Graj offline remembers the choice; Esc goes back', () => {
    const a = setup();
    click(a.root, 'offline');
    expect(a.on.offline).toHaveBeenCalled();
    expect(a.account.needsLogin).toBe(false);
    const b = setup();
    expect(b.screen.onKey(key('Escape'))).toBe(true);
    expect(b.on.back).toHaveBeenCalled();
  });
});

describe('Postacie online', () => {
  function setup(account: AccountSession) {
    const root = host();
    const on = {
      play: vi.fn(),
      new: vi.fn(),
      close: vi.fn(),
      offline: vi.fn(),
      out: vi.fn(),
    };
    const screen = createCloudCharactersScreen({
      root,
      account,
      onPlay: on.play,
      onNew: on.new,
      onClose: on.close,
      onOffline: on.offline,
      onSignedOut: on.out,
      now: () => new Date(2026, 9, 4, 20, 0).getTime(),
    });
    return { root, screen, on };
  }

  it('cards with cloud status, location „—”, usage and the account header', async () => {
    const account = session('google');
    await account.restore();
    const { root, screen, on } = setup(account);
    await flush();
    const names = [...root.querySelectorAll('.dza-card-name')].map((n) => n.textContent);
    expect(names).toEqual(['Marta Nowak', 'Ola Zielińska', 'Jan Kowalski', 'Piotr Wrona']);
    expect(root.querySelector('.dza-usage')?.textContent).toContain('3 / 20 żywych postaci');
    expect(root.querySelector('.dza-usage')?.textContent).toContain('12 / 50 MB');
    expect(root.querySelector('.dza-acct-mail')?.textContent).toBe(MOCK_EMAIL);
    expect(root.querySelectorAll('.dza-card')[1]?.textContent).toContain('—');
    expect(root.querySelector('.dza-new')?.textContent).toContain('zostało 17 miejsc');
    expect(root.querySelector('.dza-card--dead')?.textContent).toContain('USUŃ NAGROBEK');
    screen.onKey(key('Enter'));
    expect(on.play).toHaveBeenCalledWith(expect.objectContaining({ name: 'Marta Nowak' }));
  });

  it('a save in flight blocks Graj (CZEKAJ…); Del asks with the server text', async () => {
    const account = session('google');
    await account.restore();
    const { root, screen } = setup(account);
    await flush();
    account.setSyncing('6f1c2b1e-0d7a-4f43-9a64-1b2f3c4d5e02', true);
    expect(root.textContent).toContain('CZEKAJ…');
    expect(root.textContent).toContain('SYNCHRONIZUJĘ…');
    screen.onKey(key('Delete'));
    expect(root.querySelector('.dzo-confirm')?.textContent).toContain(
      'Postać i jej zapis zostaną usunięte z serwera na zawsze.',
    );
  });

  it('network error: banner with retry and offline', async () => {
    const account = session('google', { failList: true });
    await account.restore();
    const { root, on } = setup(account);
    await flush();
    expect(root.querySelector('.dza-banner')?.textContent).toContain(
      'Brak połączenia z serwerem. Postacie z konta są niedostępne.',
    );
    click(root, 'offline');
    expect(on.offline).toHaveBeenCalled();
  });

  it('401 → session expired', async () => {
    const account = session(); // not logged in at the API
    const { on } = setup(account);
    await flush();
    expect(on.out).toHaveBeenCalledWith(true);
    expect(account.pendingToast).toBe('Sesja wygasła. Zaloguj się ponownie.');
  });
});

describe('Konflikt sesji', () => {
  const local = { day: 12, minuteOfDay: 360, savedAt: new Date(2026, 9, 4, 10, 58).getTime() };
  const now = () => new Date(2026, 9, 4, 11, 10).getTime();

  it('table from SaveConflictError.server: null = brak zapisu, minute null = —; toast meta', () => {
    const updatedAt = new Date(2026, 9, 4, 11, 4).toISOString();
    expect(compareRows(undefined, local, now())).toBeUndefined();
    expect(
      compareRows({ version: 2, gameDay: 14, minuteOfDay: 664, updatedAt: 'x' }, local, now()),
    ).toBeUndefined();
    expect(
      compareRows({ version: 2, gameDay: 14, minuteOfDay: 664, updatedAt }, local, now()),
    ).toEqual({
      server: 'dzień 14, 11:04 · dzisiaj, 11:04',
      local: 'dzień 12, 06:00 · dzisiaj, 10:58',
    });
    expect(
      compareRows({ version: 2, gameDay: 14, minuteOfDay: null, updatedAt }, local, now()),
    ).toEqual({
      server: 'dzień 14, — · dzisiaj, 11:04',
      local: 'dzień 12, 06:00 · dzisiaj, 10:58',
    });
    expect(compareRows(null, { day: 12, savedAt: local.savedAt }, now())).toEqual({
      server: 'brak zapisu',
      local: 'dzień 12, — · dzisiaj, 10:58',
    });
    expect(toastMeta('autosave', local)).toBe('autozapis · dzień 12, 06:00 · teraz');
    expect(toastMeta('exit', local)).toBe('Zapisz i wyjdź · dzień 12, 06:00 · teraz');
  });

  it('409: toast + window, Enter loads the newer state; no table without data', () => {
    const el = host();
    const on = { load: vi.fn(), menu: vi.fn() };
    const d = showSaveConflict({
      host: el,
      kind: 'conflict',
      name: 'Marta Nowak',
      female: true,
      trigger: 'autosave',
      local,
      now,
      onLoadNewer: on.load,
      onMenu: on.menu,
    });
    expect(el.querySelector('.dza-toast')?.textContent).toContain('Zapis odrzucony');
    expect(el.querySelector('.dza-cmp')).toBeNull();
    expect(el.textContent).toContain('WCZYTAJ NOWSZY STAN');
    d.onKey(key('Enter'));
    expect(on.load).toHaveBeenCalled();
    expect(el.querySelector('.dza-toast')).toBeNull();
  });

  it('409 with server: null → brak zapisu, no WCZYTAJ NOWSZY STAN; Enter goes to the menu', () => {
    const el = host();
    const on = { load: vi.fn(), menu: vi.fn() };
    const d = showSaveConflict({
      host: el,
      kind: 'conflict',
      name: 'Marta Nowak',
      female: true,
      trigger: 'autosave',
      local,
      server: null,
      now,
      onLoadNewer: on.load,
      onMenu: on.menu,
    });
    expect(el.querySelector('.dza-cmp-new')?.textContent).toBe('brak zapisu');
    expect(el.querySelector('[data-act="load"]')).toBeNull();
    expect(el.textContent).not.toContain('WCZYTAJ NOWSZY STAN');
    expect(el.querySelectorAll('.dza-btn')).toHaveLength(1);
    expect(el.querySelector('[data-act="menu"]')?.classList.contains('dza-btn--pri')).toBe(true);
    expect(el.querySelector('.dza-cmp-old')?.textContent).toBe('dzień 12, 06:00 · dzisiaj, 10:58');
    d.onKey(key('Enter'));
    expect(on.menu).toHaveBeenCalled();
    expect(on.load).not.toHaveBeenCalled();
  });

  it('same in game and pause: WCZYTAJ NOWSZY STAN primary on the right, WYJDŹ DO MENU left', () => {
    for (const trigger of ['autosave', 'exit'] as const) {
      const el = host();
      const on = { load: vi.fn(), menu: vi.fn() };
      const d = showSaveConflict({
        host: el,
        kind: 'conflict',
        name: 'Marta Nowak',
        female: true,
        trigger,
        local,
        server: { version: 15, gameDay: 14, minuteOfDay: 664, updatedAt: local.savedAt.toString() },
        now,
        onLoadNewer: on.load,
        onMenu: on.menu,
      });
      const acts = [...el.querySelectorAll<HTMLElement>('.dza-conflict-foot .dza-btn')].map(
        (b) => b.dataset.act,
      );
      expect(acts).toEqual(['menu', 'load']);
      expect(el.querySelector('[data-act="load"]')?.classList.contains('dza-btn--pri')).toBe(true);
      expect(el.querySelector('[data-act="menu"]')?.classList.contains('dza-btn--pri')).toBe(false);
      d.onKey(key('Enter'));
      expect(on.load).toHaveBeenCalledOnce();
    }
  });

  it('NADPISZ SERWER: red row, second step with the server day and a tick box', () => {
    const el = host();
    const on = { load: vi.fn(), menu: vi.fn(), overwrite: vi.fn() };
    const d = showSaveConflict({
      host: el,
      kind: 'conflict',
      name: 'Marta Nowak',
      female: true,
      trigger: 'autosave',
      local,
      server: { version: 15, gameDay: 14, minuteOfDay: 664, updatedAt: '2026-10-11T09:04:00Z' },
      now,
      onLoadNewer: on.load,
      onMenu: on.menu,
      onOverwrite: on.overwrite,
    });
    const ow = el.querySelector<HTMLElement>('[data-act="overwrite"]')!;
    expect(ow.classList.contains('dza-btn--danger')).toBe(true);
    expect(ow.classList.contains('dza-btn--overwrite')).toBe(true);
    ow.click();
    expect(on.overwrite).not.toHaveBeenCalled();
    expect(el.textContent).toContain('NADPISAĆ SERWER?');
    expect(el.textContent).toContain('Stracisz postęp z dnia 14 (11:04) na serwerze.');
    const yes = el.querySelector<HTMLButtonElement>('[data-act="confirm-overwrite"]')!;
    expect(yes.disabled).toBe(true);
    // Enter before ticking does nothing; Esc goes back to the first step.
    d.onKey(key('Enter'));
    expect(on.overwrite).not.toHaveBeenCalled();
    d.onKey(key('Escape'));
    expect(on.menu).not.toHaveBeenCalled();
    expect(el.textContent).toContain('WCZYTAJ NOWSZY STAN');
    el.querySelector<HTMLElement>('[data-act="overwrite"]')!.click();
    const box = el.querySelector<HTMLInputElement>('[data-confirm-check]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(el.querySelector<HTMLButtonElement>('[data-act="confirm-overwrite"]')!.disabled).toBe(
      false,
    );
    el.querySelector<HTMLElement>('[data-act="confirm-overwrite"]')!.click();
    expect(on.overwrite).toHaveBeenCalledOnce();
    expect(el.querySelector('.dza-conflict-layer')).toBeNull();
  });

  it('NADPISZ SERWER: day only without minuteOfDay; not offered for server: null, unknown or 410', () => {
    expect(overwriteLoss({ version: 2, gameDay: 9, minuteOfDay: null, updatedAt: 'T' })).toBe(
      'Stracisz postęp z dnia 9 na serwerze.',
    );
    for (const [kind, server] of [
      ['conflict', null],
      ['conflict', undefined],
      ['gone', undefined],
    ] as const) {
      const el = host();
      showSaveConflict({
        host: el,
        kind,
        name: 'Marta Nowak',
        female: true,
        trigger: 'autosave',
        local,
        server,
        now,
        onLoadNewer: vi.fn(),
        onMenu: vi.fn(),
        onOverwrite: vi.fn(),
      });
      expect(el.querySelector('[data-act="overwrite"]')).toBeNull();
    }
  });

  it('410: TA POSTAĆ NIE ŻYJE, one button to the menu', () => {
    const el = host();
    const onMenu = vi.fn();
    showSaveConflict({
      host: el,
      kind: 'gone',
      name: 'Marta Nowak',
      female: true,
      trigger: 'autosave',
      local,
      onLoadNewer: vi.fn(),
      onMenu,
    });
    expect(el.textContent).toContain('TA POSTAĆ NIE ŻYJE');
    expect(el.textContent).toContain('Marta Nowak zginęła na innym urządzeniu. Zostaje nagrobek.');
    expect(el.querySelectorAll('.dza-btn')).toHaveLength(1);
    expect(el.querySelector('.dza-toast')).toBeNull();
    el.querySelector<HTMLElement>('[data-act="menu"]')!.click();
    expect(onMenu).toHaveBeenCalled();
  });
});

describe('Ustawienia › Konto', () => {
  it('USUŃ KONTO NA ZAWSZE only after the e-mail matches (any case); ANULUJ clears', async () => {
    const account = session('google');
    await account.restore();
    const onDeleted = vi.fn();
    const p = createAccountPanel({ account, onDeleted });
    host().appendChild(p.el);
    await flush();
    const del = () => p.el.querySelector<HTMLButtonElement>('[data-act="delete"]')!;
    expect(p.el.textContent).toContain('Marta Nowak, Jan Kowalski, Ola Zielińska');
    expect(p.el.textContent).toContain('3 żywe postacie');
    expect(del().disabled).toBe(true);
    type(p.el, 'confirm-email', 'pawel.rosol@gmail.co');
    expect(del().disabled).toBe(true);
    type(p.el, 'confirm-email', ' Pawel.ROSOL@gmail.com ');
    expect(del().disabled).toBe(false);
    click(p.el, 'cancel');
    expect(del().disabled).toBe(true);
    type(p.el, 'confirm-email', MOCK_EMAIL);
    del().click();
    await flush();
    expect(onDeleted).toHaveBeenCalled();
    expect(account.user).toBeUndefined();
    expect(account.pendingToast).toBe('Konto zostało usunięte.');
  });

  it('Pobierz moje dane downloads the AccountExport under the server file name', async () => {
    // Fixed clock for both the panel and the mock API (the server file name carries the date).
    const now = (): number => Date.UTC(2026, 9, 4, 12);
    const account = session('email', { now });
    await account.restore();
    const download = vi.fn();
    const p = createAccountPanel({ account, download, now });
    host().appendChild(p.el);
    await flush();
    expect(p.el.textContent).toContain('E-mail i hasło');
    click(p.el, 'export');
    await flush();
    expect(download).toHaveBeenCalledWith('deadzone-export-2026-10-04.json', expect.any(String));
    const file = JSON.parse(String(download.mock.calls[0]?.[1])) as AccountExport;
    expect(file.format).toBe('deadzone-account-export');
    expect(file.characters.find((c) => c.status === 'alive')?.save?.expiresInSeconds).toBe(600);
    expect(exportFileName(Date.UTC(2026, 0, 2, 12))).toBe('deadzone-export-2026-01-02.json');
    expect(emailMatches('', '')).toBe(false);
  });

  it('export 429 → Spróbuj ponownie za X min (limit 5/h)', async () => {
    const account = session('email');
    await account.restore();
    const download = vi.fn();
    const p = createAccountPanel({ account, download });
    host().appendChild(p.el);
    await flush();
    for (let i = 0; i < 6; i++) {
      click(p.el, 'export');
      await flush();
    }
    expect(download).toHaveBeenCalledTimes(5);
    expect(p.el.textContent).toContain('Spróbuj ponownie za 60 min');
    expect(exportRetryMessage(61)).toBe('Spróbuj ponownie za 2 min');
    expect(exportRetryMessage(5)).toBe('Spróbuj ponownie za 1 min');
    expect(exportRetryMessage(undefined)).toContain('Spróbuj ponownie później');
    expect(emailMatches('', '')).toBe(false);
  });

  it('logged out: only ZALOGUJ SIĘ; the tab is last and only online', () => {
    const onLogin = vi.fn();
    const p = createAccountPanel({ account: session(), onLogin });
    expect(p.el.querySelector('.dza-dz')).toBeNull();
    click(p.el, 'login');
    expect(onLogin).toHaveBeenCalled();
    expect(settingsTabs(false).map((t) => t.id)).not.toContain('account');
    const tabs = settingsTabs(true);
    expect(tabs.at(-1)).toEqual({ id: 'account', label: 'Konto' });
    expect(stepTab('interface', 1, tabs)).toBe('account');
    expect(stepTab('account', 1, tabs)).toBe('graphics');
  });
});

describe('boot', () => {
  it('online review flags keep the menu; game test params still skip it', () => {
    expect(shouldShowMenu('?online=mock')).toBe(true);
    expect(shouldShowMenu('?online=mock&as=google&screen=chars')).toBe(true);
    expect(shouldShowMenu('?online=mock&map=test')).toBe(false);
  });
});
