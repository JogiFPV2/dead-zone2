import type { DeathCause } from '@deadzone/protocol';

/** TEMPORARY Polish cause labels (no i18n files yet). */
const CAUSES: Record<DeathCause, string> = {
  bleeding: 'Wykrwawienie',
  starvation: 'Śmierć głodowa',
  dehydration: 'Odwodnienie',
  infection: 'Infekcja',
  temperature: 'Wychłodzenie / przegrzanie',
  wounds: 'Rany',
  zombie: 'Zagryziony',
  fall: 'Upadek z wysokości',
  debug: 'Debug',
};

export const causeLabel = (c: DeathCause): string => CAUSES[c];

/** `1 dzień`, `2 dni`, `12 dni`. */
export const daysWord = (n: number): string => (n === 1 ? 'dzień' : 'dni');

/** `Dzień 12, 21:47`. */
export function deathTimeLabel(day: number, minuteOfDay: number): string {
  const m = Math.floor(minuteOfDay);
  const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `Dzień ${day}, ${hh}:${mm}`;
}

export interface RecordStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECORD_KEY = 'deadzone.record.days';

/** Reads the best run (days), stores the new one if better; returns the previous best. */
export function updateRecord(store: RecordStore | undefined, days: number): number | undefined {
  if (!store) return undefined;
  let prev: number | undefined;
  try {
    const raw = store.getItem(RECORD_KEY);
    const n = raw === null ? NaN : Number(raw);
    prev = Number.isFinite(n) ? n : undefined;
    if (prev === undefined || days > prev) store.setItem(RECORD_KEY, String(days));
  } catch {
    // Storage blocked (private mode): no record.
  }
  return prev;
}
