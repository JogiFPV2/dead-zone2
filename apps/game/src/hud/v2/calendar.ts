/**
 * In-game calendar for the top bar (`Dzień 12 · 14 lipca 1993 · 14:32`). The sim only counts
 * days, so the date is derived here: day 1 = 3 July 1993 (mockup: day 12 = 14 July 1993).
 * TODO(sim): read the start date from world settings once the sim has one.
 */
export const CALENDAR_START = { year: 1993, month: 7, day: 3 } as const;

const MONTHS_GENITIVE = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];

/** `14 lipca 1993` for game day `day` (1-based). */
export function gameDate(day: number, start = CALENDAR_START): string {
  const d = new Date(Date.UTC(start.year, start.month - 1, start.day + Math.max(1, day) - 1));
  return `${d.getUTCDate()} ${MONTHS_GENITIVE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `14:32` (24 h). */
export function clockTime(minuteOfDay: number): string {
  const m = ((Math.floor(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
