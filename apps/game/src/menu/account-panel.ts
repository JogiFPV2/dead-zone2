import type { AccountUsage, CloudCharacter } from '../account/account-api.js';
import type { AccountSession } from '../account/account-session.js';
import {
  dateLabel,
  mbLabel,
  usageColor,
  usageFraction,
  usageLabel,
} from './cloud-characters-model.js';
import { GOOGLE_G, icon } from './icons.js';

export interface AccountPanelOptions {
  readonly account: AccountSession;
  /** ZALOGUJ SIĘ (logged out): the owner closes Ustawienia and opens Logowanie. */
  onLogin?: (() => void) | undefined;
  /** WYLOGUJ done. */
  onSignedOut?: (() => void) | undefined;
  /** Account deleted (the session is already logged out and holds the menu toast). */
  onDeleted?: (() => void) | undefined;
  /** File download (tests replace it). */
  download?: (name: string, json: string) => void;
  now?: () => number;
}

export interface AccountPanel {
  /** Persistent element: the settings screen re-inserts it after each render. */
  readonly el: HTMLElement;
  dispose(): void;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const pct = (f: number): string => `${Math.round(f * 1000) / 10}%`;

/** Typed e-mail matches the account's (trimmed, case-insensitive). */
export const emailMatches = (typed: string, email: string): boolean =>
  typed.trim().toLowerCase() === email.trim().toLowerCase() && email.length > 0;

/** `3 żywe postacie`, `1 żywą postać`, `5 żywych postaci` (accusative after „usuniemy”). */
export function aliveAccusative(n: number): string {
  if (n === 1) return '1 żywą postać';
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  return `${n} ${few ? 'żywe postacie' : 'żywych postaci'}`;
}

/**
 * Fallback name when the server's `Content-Disposition` is not readable: the server's pattern
 * `deadzone-export-2026-10-04.json` (UTC date, like the server).
 */
export function exportFileName(now: number): string {
  return `deadzone-export-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/** 429 of `GET /v1/me/export` (5/h): `Spróbuj ponownie za 12 min` (rounded up, at least 1). */
export function exportRetryMessage(retryAfterSec: number | undefined): string {
  if (retryAfterSec === undefined)
    return 'Limit eksportów (5 na godzinę). Spróbuj ponownie później.';
  return `Spróbuj ponownie za ${Math.max(1, Math.ceil(retryAfterSec / 60))} min`;
}

function browserDownload(name: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Ustawienia › Konto (mockup account-settings.png): account data, storage (from
 * `GET /v1/characters`), RODO export and the danger zone. „USUŃ KONTO NA ZAWSZE” is enabled only
 * once the typed e-mail matches (case-insensitive). Logged out: only ZALOGUJ SIĘ.
 */
export function createAccountPanel(o: AccountPanelOptions): AccountPanel {
  const { account } = o;
  const now = o.now ?? Date.now;
  const el = document.createElement('div');
  el.className = 'dza-set-wrap';
  let usage: AccountUsage | undefined;
  let alive: CloudCharacter[] = [];
  let typed = '';
  let exporting = false;
  let deleting = false;
  let message = '';
  let disposed = false;

  async function load(): Promise<void> {
    if (!account.user) return;
    const r = await account.api.listCharacters();
    if (disposed) return;
    if (r.ok) {
      usage = r.usage;
      alive = r.characters.filter((c) => c.status === 'alive');
    } else if (r.reason === 'unauthorized') account.expired();
    render();
  }

  function deleteButton(): HTMLButtonElement | null {
    return el.querySelector<HTMLButtonElement>('[data-act="delete"]');
  }

  /** Only the parts that depend on the typed e-mail (no re-render while typing). */
  function syncTyped(): void {
    const u = account.user;
    const ok = !!u && emailMatches(typed, u.email);
    const btn = deleteButton();
    if (btn) btn.disabled = !ok || deleting;
    const mark = el.querySelector<HTMLElement>('.dza-dz-ok');
    if (mark) mark.hidden = !ok;
  }

  function render(): void {
    if (disposed) return;
    const u = account.user;
    if (!u) {
      el.innerHTML = `<div class="dza-set"><div class="dza-set-col"><div class="dza-hdr"><span>Konto</span><em>niezalogowano · gra offline</em></div>
<div class="dza-signin"><span>Zaloguj się, żeby postacie były zapisane na koncie. Grasz dalej na każdym komputerze, a zapis sprawdza serwer.</span>
<span>${icon('cloudOk', 14)} Autozapis raz na dzień gry · „Zapisz i wyjdź”<br>${icon('user', 14)} Do 20 żywych postaci · 50 MB na konto<br>${icon('grave', 14)} Śmierć jest ostateczna, zostaje nagrobek</span>
${o.onLogin ? `<button type="button" class="dza-btn dza-btn--pri" data-act="login">${icon('user', 15)}ZALOGUJ SIĘ</button>` : '<span>Zalogujesz się w menu głównym.</span>'}</div></div></div>`;
      return;
    }
    const used = usage ? usageFraction(usage.usedBytes, usage.limitBytes) : 0;
    const aliveF = usage ? usageFraction(usage.alive, usage.aliveLimit) : 0;
    const method =
      u.method === 'google'
        ? `<div class="dza-srow-text"><b>Metoda logowania</b><span>Google${u.linkedAt ? ` · konto połączone ${esc(dateLabel(u.linkedAt))}` : ''}</span></div><span class="dza-chip dza-chip--plain">${GOOGLE_G(12)}GOOGLE</span>`
        : `<div class="dza-srow-text"><b>Metoda logowania</b><span>E-mail i hasło · <button type="button" class="dza-link" data-act="password">Zmień hasło</button></span></div><span class="dza-chip dza-chip--plain">${icon('mail', 12)}E-MAIL</span>`;
    const names = alive.map((c) => c.name).join(', ');
    const ok = emailMatches(typed, u.email);
    el.innerHTML = `<div class="dza-set"><div class="dza-set-col">
<div class="dza-hdr"><span>Konto</span><em>zalogowano · sesja na tym urządzeniu</em></div>
<div class="dza-srow"><div class="dza-srow-text"><b>E-mail</b><span>${esc(u.email)}</span></div>${u.emailConfirmed ? `<span class="dza-chip dza-chip--ok">${icon('check', 11)}POTWIERDZONY</span>` : '<span class="dza-chip dza-chip--warn">NIEPOTWIERDZONY</span>'}</div>
<div class="dza-srow">${method}</div>
<div class="dza-srow"><div class="dza-srow-text"><b>Wyloguj</b><span>Postacie zostają na koncie</span></div><button type="button" class="dza-btn dza-btn--sec" data-act="logout">${icon('exit', 14)}WYLOGUJ</button></div>
<div class="dza-hdr"><span>Miejsce</span><em>liczone na serwerze</em></div>
<div class="dza-space"><div class="dza-space-row"><span>Zapisy postaci</span><b>${usage ? usageLabel(usage) : '— / 50 MB'}</b></div>
<div class="dza-bar"><i style="width:${pct(used)};background:${usageColor(used)}"></i></div>
<div class="dza-space-row"><span>Żywe postacie</span><b>${usage ? `${usage.alive} / ${usage.aliveLimit}` : '— / 20'} żywych</b></div>
<div class="dza-bar"><i style="width:${pct(aliveF)};background:#7f9a4e"></i></div></div>
<div class="dza-hdr"><span>Dane i prywatność</span><em>RODO</em></div>
<div class="dza-srow"><div class="dza-srow-text"><b>Pobierz moje dane</b><span>Plik JSON: konto, postacie, zapisy i nagrobki</span></div><button type="button" class="dza-btn dza-btn--sec" data-act="export"${exporting ? ' disabled' : ''}>${exporting ? `${icon('sync', 14)}PRZYGOTOWUJĘ…` : `${icon('download', 14)}POBIERZ`}</button></div>
${message ? `<div class="dza-ok" role="status">${esc(message)}</div>` : ''}
</div>
<div class="dza-dz"><div class="dza-dz-head">${icon('warning', 18)}<span>STREFA NIEBEZPIECZNA</span></div>
<div class="dza-dz-title">Usuń konto</div>
<div class="dza-dz-body">Na zawsze usuniemy konto, ${aliveAccusative(alive.length)}, ich zapisy i nagrobki. Tego nie da się cofnąć ani przywrócić.</div>
<div class="dza-dz-list">${names ? `<span><i class="dza-x">${icon('x', 12)}</i>${esc(names)}</span>` : ''}<span><i class="dza-x">${icon('x', 12)}</i>${usage ? mbLabel(usage.usedBytes) : '—'} zapisów w chmurze</span><span><i class="dza-v">${icon('check', 12)}</i>Zapisy offline w przeglądarce zostają</span></div>
<div class="dza-dz-sep"></div>
<span class="dza-dz-ask">Aby potwierdzić, wpisz swój e-mail: <b>${esc(u.email)}</b></span>
<label class="dza-field"><input name="confirm-email" type="email" autocomplete="off" spellcheck="false" value="${esc(typed)}" aria-label="Wpisz swój e-mail, aby potwierdzić"${deleting ? ' disabled' : ''}><span class="dza-dz-ok"${ok ? '' : ' hidden'}>${icon('check', 15)}</span></label>
<div class="dza-dz-foot"><button type="button" class="dza-btn dza-btn--sec" data-act="cancel">ANULUJ</button><button type="button" class="dza-btn dza-btn--fill-danger" data-act="delete"${ok && !deleting ? '' : ' disabled'}>${deleting ? `${icon('sync', 14)}USUWAM…` : `${icon('trash', 14)}USUŃ KONTO NA ZAWSZE`}</button></div>
<span class="dza-dz-hint">Przycisk aktywny dopiero po wpisaniu dokładnego e-maila.</span></div></div>`;
  }

  async function doExport(): Promise<void> {
    exporting = true;
    message = '';
    render();
    const r = await account.api.exportData();
    if (disposed) return;
    exporting = false;
    if (r.ok) {
      (o.download ?? browserDownload)(
        r.fileName ?? exportFileName(now()),
        JSON.stringify(r.data, null, 2),
      );
      message = 'Plik z danymi pobrany.';
    } else if (r.reason === 'unauthorized') account.expired();
    else if (r.reason === 'rate-limited') message = exportRetryMessage(r.retryAfterSec);
    else message = 'Nie udało się przygotować danych. Spróbuj ponownie.';
    render();
  }

  async function doDelete(): Promise<void> {
    const u = account.user;
    if (!u || !emailMatches(typed, u.email) || deleting) return;
    deleting = true;
    render();
    const r = await account.api.deleteAccount();
    if (disposed) return;
    deleting = false;
    if (r.ok) {
      typed = '';
      account.deleted();
      o.onDeleted?.();
      return;
    }
    if (r.reason === 'unauthorized') account.expired();
    else message = 'Nie udało się usunąć konta. Spróbuj ponownie.';
    render();
  }

  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = t?.dataset.act;
    if (!act || (t as HTMLButtonElement).disabled) return;
    if (act === 'login') o.onLogin?.();
    else if (act === 'logout') {
      void account.signOut().then(() => {
        render();
        o.onSignedOut?.();
      });
    } else if (act === 'export') void doExport();
    else if (act === 'cancel') {
      typed = '';
      const input = el.querySelector<HTMLInputElement>('input[name="confirm-email"]');
      if (input) input.value = '';
      syncTyped();
    } else if (act === 'delete') void doDelete();
    else if (act === 'password' && account.user) {
      void account.api.sendPasswordReset(account.user.email, 'session').then((r) => {
        message = r.ok
          ? `Wysłaliśmy link do zmiany hasła na ${account.user?.email ?? ''}.`
          : 'Nie udało się wysłać linku.';
        render();
      });
    }
  });
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.name === 'confirm-email') {
      typed = t.value;
      syncTyped();
    }
  });
  const unsub = account.subscribe(() => render());
  render();
  void load();

  return {
    el,
    dispose() {
      disposed = true;
      unsub();
      el.remove();
    },
  };
}
