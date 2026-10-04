/** Pure helpers of the Postacie screen (deadzone-menu-spec §7, mockup characters.png). */
import type { DeathCause } from '@deadzone/protocol';
import type { CharacterRecord, Portrait } from '../characters/schema.js';
import { causeLabel } from '../death/death-model.js';
import { isOldMap } from '../boot-options.js';

export type CardAction = 'play' | 'delete';

export interface CardView {
  readonly id: string;
  readonly name: string;
  /** `TEST TOWN · AKTYWNA` (`· STARA MAPA` when saved on an older map). */
  readonly sub: string;
  readonly dead: boolean;
  readonly portrait: Portrait;
  readonly days: { label: string; value: string };
  readonly second: { label: string; value: string; danger?: boolean };
  readonly actions: readonly CardAction[];
}

/** Masculine names ending in -a (Polish forms otherwise follow the first name's last letter). */
const MASC_A = new Set(['kuba', 'barnaba', 'bonawentura', 'kosma', 'jarema', 'boryna']);

/** Feminine Polish forms (PRZEŻYŁA, OCALAŁA) when the first name looks feminine. */
export function feminine(name: string): boolean {
  const first = (name.trim().split(/\s+/)[0] ?? '').toLowerCase();
  return first.endsWith('a') && !MASC_A.has(first);
}

export function daysLabel(n: number): string {
  return `${n} ${n === 1 ? 'DZIEŃ' : 'DNI'}`;
}

/** `Test Town` from `test-town`. */
export function mapLabel(map: string): string {
  if (map === 'test') return 'Mapa testowa';
  return map
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export const MONTHS = [
  'sty',
  'lut',
  'mar',
  'kwi',
  'maj',
  'cze',
  'lip',
  'sie',
  'wrz',
  'paź',
  'lis',
  'gru',
];
const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** `dzisiaj, 19:52` · `wczoraj, 22:10` · `28 wrz, 08:14` (local time). */
export function playedLabel(at: number, now: number): string {
  const d = new Date(at);
  const day = (t: number): number => {
    const x = new Date(t);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  };
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return `dzisiaj, ${hhmm(d)}`;
  if (diff === 1) return `wczoraj, ${hhmm(d)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hhmm(d)}`;
}

/** Card of one character; `active` = the most recently played living one (Kontynuuj). */
export function cardView(c: CharacterRecord, now: number, active: boolean): CardView {
  const fem = feminine(c.name);
  const dead = c.status === 'dead';
  const status = dead
    ? fem
      ? 'ZMARŁA'
      : 'ZMARŁY'
    : active
      ? 'AKTYWNA'
      : fem
        ? 'OCALAŁA'
        : 'OCALAŁY';
  return {
    id: c.id,
    name: c.name,
    sub: `${mapLabel(c.worldSettings.map).toUpperCase()} · ${status}${isOldMap(c.worldSettings.map) ? ' · STARA MAPA' : ''}`,
    dead,
    portrait: c.appearance.portrait,
    days: { label: fem ? 'PRZEŻYŁA' : 'PRZEŻYŁ', value: daysLabel(c.daysSurvived) },
    second: dead
      ? {
          label: 'PRZYCZYNA',
          value: c.deathCause ? (causeLabel(c.deathCause as DeathCause) ?? c.deathCause) : '—',
          danger: true,
        }
      : { label: 'OSTATNIO GRANA', value: playedLabel(c.lastPlayedAt, now) },
    actions: dead ? ['delete'] : ['play', 'delete'],
  };
}

/** Focus: a card's action, or the „Nowa postać” button (`card === -1`). */
export interface CharFocus {
  readonly card: number;
  readonly action: number;
}

export const NEW_FOCUS: CharFocus = { card: -1, action: 0 };

/**
 * Keys: ←/→ (A/D) between cards, ↑/↓ (W/S) between a card's actions and „Nowa postać” below
 * the cards. Returns undefined for other keys.
 */
export function moveFocus(
  f: CharFocus,
  code: string,
  cards: readonly Pick<CardView, 'actions'>[],
  canCreate: boolean,
): CharFocus | undefined {
  const n = cards.length;
  const clampAction = (card: number, a: number): CharFocus => ({
    card,
    action: Math.max(0, Math.min(a, (cards[card]?.actions.length ?? 1) - 1)),
  });
  const horiz =
    code === 'ArrowLeft' || code === 'KeyA' ? -1 : code === 'ArrowRight' || code === 'KeyD' ? 1 : 0;
  const vert =
    code === 'ArrowUp' || code === 'KeyW' ? -1 : code === 'ArrowDown' || code === 'KeyS' ? 1 : 0;
  if (!horiz && !vert) return undefined;
  if (f.card < 0) {
    if (vert < 0 && n) return clampAction(0, 0);
    if (horiz && n) return clampAction(horiz > 0 ? 0 : n - 1, 0);
    return f;
  }
  if (horiz) return n ? clampAction((f.card + horiz + n) % n, f.action) : f;
  const actions = cards[f.card]?.actions.length ?? 0;
  const next = f.action + vert;
  if (next >= actions) return canCreate ? NEW_FOCUS : f;
  return next < 0 ? f : { card: f.card, action: next };
}

/** `przed chwilą`, `12 min temu`, `2 godz. temu`, `3 dni temu`. */
export function agoLabel(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 1) return 'przed chwilą';
  if (min < 60) return `${min} min temu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} godz. temu`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'wczoraj' : `${d} dni temu`;
}

/** Kontynuuj's line: `Marta Nowak · Dzień 4 · 2 godz. temu`. */
export function continueLabel(c: CharacterRecord, now: number): string {
  return `${c.name} · Dzień ${c.daysSurvived + 1} · ${agoLabel(c.lastPlayedAt, now)}`;
}
