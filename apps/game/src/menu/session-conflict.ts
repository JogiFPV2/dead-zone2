import type { ServerSaveInfo } from '../account/account-api.js';
import { playedLabel } from './characters-model.js';
import { icon } from './icons.js';
import { keyBadge } from './overlay-stage.js';
import './account.css';

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const hhmm = (m: number): string =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

export type ToastTone = 'error' | 'warn' | 'info';

export interface ToastOptions {
  readonly host: HTMLElement;
  readonly title: string;
  readonly body?: string | undefined;
  readonly meta?: string | undefined;
  readonly tone?: ToastTone;
  /** Icon name (icons.ts). */
  readonly icon?: string;
  /** Auto-hide (spec: 6 s); 0 = stays until closed. */
  readonly ms?: number;
}

/** Toast top right (session-conflict.png: 360 px, inset bar, 6 s, X). */
export function showToast(o: ToastOptions): { el: HTMLElement; close(): void } {
  const el = document.createElement('div');
  const tone = o.tone ?? 'error';
  el.className = `dza-toast${tone === 'error' ? '' : ` dza-toast--${tone}`}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(o.icon ?? 'cloudOff', 20)}<div class="dza-toast-text"><b>${esc(o.title)}</b>${o.body ? `<span>${esc(o.body)}</span>` : ''}${o.meta ? `<em>${esc(o.meta)}</em>` : ''}</div><button type="button" class="dza-toast-x" aria-label="Zamknij">${icon('x', 14)}</button>`;
  o.host.appendChild(el);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    el.remove();
  };
  el.querySelector('.dza-toast-x')?.addEventListener('click', close);
  const ms = o.ms ?? 6000;
  if (ms > 0) timer = setTimeout(close, ms);
  return { el, close };
}

export interface LocalSaveInfo {
  day: number;
  minuteOfDay?: number | undefined;
  /** When this device made the rejected save (epoch ms). */
  savedAt: number;
}

export interface SaveConflictOptions {
  /** Stage (1280×720) the window covers. */
  readonly host: HTMLElement;
  /** 409: newer state elsewhere; `gone`: died on another device (410 / `character_dead`). */
  readonly kind: 'conflict' | 'gone';
  readonly name: string;
  readonly female: boolean;
  /** What was being saved: daily autosave or „Zapisz i wyjdź”. */
  readonly trigger: 'autosave' | 'exit';
  readonly local: LocalSaveInfo;
  /** `SaveConflictError.server`: null = no save on the server; undefined = no table. */
  readonly server?: ServerSaveInfo | null | undefined;
  readonly now?: () => number;
  /** Toast auto-hide (default 6 s); previews pin it with 0. */
  readonly toastMs?: number;
  /** WCZYTAJ NOWSZY STAN: download the server save and load it (local state is dropped). */
  onLoadNewer(): void;
  /** WYJDŹ DO MENU → Postacie (local state is dropped). */
  onMenu(): void;
  /**
   * NADPISZ SERWER (409 only): this device's refused save replaces the server's (forced write,
   * `If-Match` = the server's version). Without it the button is not shown (previews of #166).
   */
  onOverwrite?: (() => void) | undefined;
}

export interface SaveConflictDialog {
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
}

/** `autozapis · dzień 12, 06:00 · teraz`. */
export function toastMeta(trigger: 'autosave' | 'exit', l: LocalSaveInfo): string {
  const when = l.minuteOfDay === undefined ? '' : `, ${hhmm(l.minuteOfDay)}`;
  return `${trigger === 'exit' ? 'Zapisz i wyjdź' : 'autozapis'} · dzień ${l.day}${when} · teraz`;
}

/** Game time `dzień 14, 11:04`; a minute the server did not record shows as `—`. */
const gameTime = (day: number, minute: number | null | undefined): string =>
  `dzień ${day}, ${minute === null || minute === undefined ? '—' : hhmm(minute)}`;

/**
 * Warning of the NADPISZ SERWER confirmation: `Stracisz postęp z dnia 14 (11:04) na serwerze.`;
 * without a recorded minute just the day.
 */
export function overwriteLoss(server: ServerSaveInfo): string {
  const at = server.minuteOfDay === null ? '' : ` (${hhmm(server.minuteOfDay)})`;
  return `Stracisz postęp z dnia ${server.gameDay}${at} na serwerze.`;
}

/**
 * Rows of the comparison table from `SaveConflictError.server` (Serwer #167):
 * `dzień 14, 11:04 · dzisiaj, 11:04`; `server` null = no save on the server (`brak zapisu`);
 * undefined (409 without a valid `server`) or an unreadable `updatedAt` = no table.
 */
export function compareRows(
  server: ServerSaveInfo | null | undefined,
  local: LocalSaveInfo,
  now: number,
): { server: string; local: string } | undefined {
  if (server === undefined) return undefined;
  const here = `${gameTime(local.day, local.minuteOfDay)} · ${playedLabel(local.savedAt, now)}`;
  if (server === null) return { server: 'brak zapisu', local: here };
  const t = Date.parse(server.updatedAt);
  if (!Number.isFinite(t)) return undefined;
  return {
    server: `${gameTime(server.gameDay, server.minuteOfDay)} · ${playedLabel(t, now)}`,
    local: here,
  };
}

/**
 * Konflikt sesji (mockup session-conflict.png): the server refused this device's save because
 * another session saved newer state (409), or the character died elsewhere (410). The toast shows
 * on every 409; the window keeps the game paused until the player loads the newer state or leaves.
 */
export function showSaveConflict(o: SaveConflictOptions): SaveConflictDialog {
  const now = (o.now ?? Date.now)();
  const toast =
    o.kind === 'conflict'
      ? showToast({
          host: o.host,
          title: 'Zapis odrzucony',
          body: 'Serwer ma nowszy stan tej postaci z innego urządzenia.',
          meta: toastMeta(o.trigger, o.local),
          ...(o.toastMs === undefined ? {} : { ms: o.toastMs }),
        })
      : undefined;
  const el = document.createElement('div');
  el.className = 'dza-conflict-layer';
  el.setAttribute('role', 'alertdialog');
  const gone = o.kind === 'gone';
  // 409 with `server: null`: the server has no save of this character, nothing to load (#172):
  // WYJDŹ DO MENU only.
  const canLoad = !gone && o.server !== null;
  // NADPISZ SERWER needs the server's save (its version is the forced `If-Match`, its day the warning).
  const server = !gone && o.server ? o.server : undefined;
  const canOverwrite = !!server && !!o.onOverwrite;
  // Same in game and in the pause menu: WCZYTAJ NOWSZY STAN is the primary (right, Enter),
  // WYJDŹ DO MENU on the left (Esc); without a save to load, WYJDŹ DO MENU is the only choice.
  const menuFirst = !canLoad;
  const rows = gone ? undefined : compareRows(o.server, o.local, now);
  const title = gone ? 'TA POSTAĆ NIE ŻYJE' : 'TA POSTAĆ BYŁA GRANA<br>NA INNYM URZĄDZENIU';
  el.setAttribute('aria-label', title.replace('<br>', ' '));
  const body = gone
    ? `${esc(o.name)} ${o.female ? 'zginęła' : 'zginął'} na innym urządzeniu. Zostaje nagrobek.`
    : canLoad
      ? `${esc(o.name)} ma na serwerze nowszy stan. Wczytaj go, żeby grać dalej. Postęp z tego komputera od ostatniego zapisu przepadnie.`
      : `Na serwerze nie ma zapisu postaci ${esc(o.name)}, więc nie ma czego wczytać.`;
  const menuBtn = `<button type="button" class="dza-btn ${menuFirst ? 'dza-btn--pri dza-btn--focus' : 'dza-btn--sec'}" data-act="menu">${icon('exit', 15)}WYJDŹ DO MENU</button>`;
  const loadBtn = !canLoad
    ? ''
    : `<button type="button" class="dza-btn dza-btn--pri dza-btn--focus" data-act="load">${icon('download', 15)}WCZYTAJ NOWSZY STAN</button>`;
  const overwriteBtn = canOverwrite
    ? `<button type="button" class="dza-btn dza-btn--danger dza-btn--overwrite" data-act="overwrite" title="Zapis z tego komputera zastąpi stan na serwerze">${icon('save', 15)}NADPISZ SERWER</button>`
    : '';
  const hints = gone
    ? `<span>${keyBadge('Enter')}menu</span>`
    : menuFirst
      ? `<span>${keyBadge('Enter')}menu</span><span>${keyBadge('Esc')}menu</span>`
      : `<span>${keyBadge('Enter')}wczytaj</span><span>${keyBadge('Esc')}menu</span>`;
  const mainView = `<div class="dza-conflict-ic">${icon(gone ? 'grave' : 'monitor', 24)}</div>
<div class="dza-conflict-title">${title}</div>
${gone ? '' : '<div class="dza-conflict-sub">Twój zapis nie został przyjęty.</div>'}
<div class="dza-conflict-body">${body}</div>
${rows ? `<div class="dza-cmp"><div><span>NA SERWERZE</span><span class="dza-cmp-new">${esc(rows.server)}</span></div><div><span>TUTAJ (ODRZUCONY)</span><span class="dza-cmp-old">${esc(rows.local)}</span></div></div>` : ''}
<div class="dza-hsep"></div>
<div class="dza-conflict-foot">${menuBtn}${loadBtn}${overwriteBtn}</div>
<div class="dza-conflict-hints">${hints}<span>· gra jest wstrzymana</span></div>`;
  el.innerHTML = `<div class="dza-scrim"></div><div class="dzo-panel dza-conflict${gone ? ' dza-conflict--dead' : ''}">${mainView}</div>`;
  const panel = el.querySelector<HTMLElement>('.dza-conflict')!;
  // Under the toast, so the toast stays readable on top.
  if (toast) o.host.insertBefore(el, toast.el);
  else o.host.appendChild(el);
  el.querySelector<HTMLElement>('.dza-btn--focus')?.focus({ preventScroll: true });

  let done = false;
  let confirming = false;
  const finish = (act: 'load' | 'menu' | 'overwrite'): void => {
    if (done) return;
    done = true;
    el.remove();
    toast?.close();
    if (act === 'load') o.onLoadNewer();
    else if (act === 'overwrite') o.onOverwrite?.();
    else o.onMenu();
  };
  const checked = (): boolean =>
    !!el.querySelector<HTMLInputElement>('[data-confirm-check]')?.checked;
  /** Second step of NADPISZ SERWER: what is lost, and a box to tick before it is allowed. */
  const showConfirm = (): void => {
    if (!server) return;
    confirming = true;
    panel.classList.add('dza-conflict--confirm');
    panel.innerHTML = `<div class="dza-conflict-ic dza-conflict-ic--danger">${icon('warning', 24)}</div>
<div class="dza-conflict-title">NADPISAĆ SERWER?</div>
<div class="dza-conflict-body">${esc(overwriteLoss(server))} Zastąpi go stan z tego komputera (${esc(gameTime(o.local.day, o.local.minuteOfDay))}). Tego nie da się cofnąć.</div>
<label class="dza-confirm-check"><input type="checkbox" data-confirm-check><span>Rozumiem, że stan postaci na serwerze przepadnie</span></label>
<div class="dza-hsep"></div>
<div class="dza-conflict-foot"><button type="button" class="dza-btn dza-btn--sec" data-act="back">${icon('arrowl', 15)}ANULUJ</button><button type="button" class="dza-btn dza-btn--fill-danger" data-act="confirm-overwrite" disabled>${icon('save', 15)}NADPISZ SERWER</button></div>
<div class="dza-conflict-hints"><span>${keyBadge('Esc')}wróć</span><span>${keyBadge('Enter')}nadpisz</span></div>`;
    const box = el.querySelector<HTMLInputElement>('[data-confirm-check]')!;
    const yes = el.querySelector<HTMLButtonElement>('[data-act="confirm-overwrite"]')!;
    box.addEventListener('change', () => (yes.disabled = !box.checked));
    box.focus({ preventScroll: true });
  };
  const backToMain = (): void => {
    confirming = false;
    panel.classList.remove('dza-conflict--confirm');
    panel.innerHTML = mainView;
    el.querySelector<HTMLElement>('.dza-btn--focus')?.focus({ preventScroll: true });
  };
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'load' || act === 'menu') finish(act);
    else if (act === 'overwrite') showConfirm();
    else if (act === 'back') backToMain();
    else if (act === 'confirm-overwrite' && checked()) finish('overwrite');
  });

  return {
    onKey(e) {
      if (done) return false;
      if (confirming) {
        if (e.code === 'Escape') backToMain();
        else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          if (e.target instanceof HTMLButtonElement && el.contains(e.target)) return false;
          if (checked()) finish('overwrite');
        } else return e.code === 'Tab' || e.code === 'Space' ? false : true;
        return true;
      }
      if (e.code === 'Escape') finish('menu');
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (e.target instanceof HTMLButtonElement && el.contains(e.target)) return false;
        finish(menuFirst ? 'menu' : 'load');
      } else return e.code === 'Tab' ? false : true;
      return true;
    },
    dispose() {
      done = true;
      el.remove();
      toast?.close();
    },
  };
}
