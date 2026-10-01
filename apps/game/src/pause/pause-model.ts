/** Pause menu (deadzone-menu-spec §6), pure: items, keys, Escape routing, labels. */
import { formatMinute } from '../lighting/game-clock.js';

export type PauseItemId = 'resume' | 'settings' | 'saveExit';

export const PAUSE_ITEMS: readonly { id: PauseItemId; label: string; icon: string }[] = [
  { id: 'resume', label: 'Wróć do gry', icon: 'playOutline' },
  { id: 'settings', label: 'Ustawienia', icon: 'gear' },
  { id: 'saveExit', label: 'Zapisz i wyjdź do menu', icon: 'save' },
];

export type PauseKeyCommand =
  { type: 'move'; delta: 1 | -1 } | { type: 'activate' } | { type: 'resume' };

/** ↑/↓ (W/S, Tab) move the focus, Enter/Space activate, Esc resumes (never saves). */
export function pauseKey(code: string, shift: boolean): PauseKeyCommand | undefined {
  if (code === 'ArrowDown' || code === 'KeyS') return { type: 'move', delta: 1 };
  if (code === 'ArrowUp' || code === 'KeyW') return { type: 'move', delta: -1 };
  if (code === 'Tab') return { type: 'move', delta: shift ? -1 : 1 };
  if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') return { type: 'activate' };
  if (code === 'Escape') return { type: 'resume' };
  return undefined;
}

export const stepPauseFocus = (i: number, delta: number): number => {
  const n = PAUSE_ITEMS.length;
  return (((i + delta) % n) + n) % n;
};

/** Something Escape can close (inventory, container, workshop, …). */
export interface Closable {
  readonly open: boolean;
  close(): void;
}

export type EscapeAction = 'closeWindow' | 'openPause' | 'none';

/**
 * In-game Escape: an open window closes first; only with none open does the pause menu open.
 * Dead players (death screen) get nothing.
 */
export function escapeAction(windows: readonly Closable[], dead: boolean): EscapeAction {
  if (windows.some((w) => w.open)) return 'closeWindow';
  return dead ? 'none' : 'openPause';
}

/** Escape in game: closes every open window, or opens the pause menu. */
export function handleEscape(
  windows: readonly Closable[],
  dead: boolean,
  openPause: () => void,
): EscapeAction {
  const a = escapeAction(windows, dead);
  if (a === 'closeWindow') {
    for (const w of windows) if (w.open) w.close();
  } else if (a === 'openPause') openPause();
  return a;
}

export interface PauseInfo {
  day?: number | undefined;
  minuteOfDay?: number | undefined;
  location: string;
}

/** „Dzień 12 · 19:52 · Riverside” (missing parts are skipped). */
export function pauseSubtitle(i: PauseInfo): string {
  return [
    i.day !== undefined ? `Dzień ${i.day}` : undefined,
    i.minuteOfDay !== undefined ? formatMinute(i.minuteOfDay) : undefined,
    i.location,
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface WorldSaveMeta {
  day: number;
  minuteOfDay?: number | undefined;
  /** Real time (ms since epoch). */
  savedAt: number;
}

/** „Ostatni zapis: Dzień 12 · 19:51 · zapis świata”, or that there is none yet. */
export function lastSaveLine(meta: WorldSaveMeta | undefined): string {
  if (!meta) return 'Brak zapisu świata';
  const time = meta.minuteOfDay !== undefined ? ` · ${formatMinute(meta.minuteOfDay)}` : '';
  return `Ostatni zapis: Dzień ${meta.day}${time} · zapis świata`;
}
