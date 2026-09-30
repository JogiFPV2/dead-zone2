import type { SimEvent } from '@deadzone/protocol';
import type { GameState } from './game-state.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** `D1 09:05` */
export const formatClock = (day: number, minuteOfDay: number): string =>
  `D${day} ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;

/** One-line event description for dev logs. */
export function describeEvent(e: SimEvent): string {
  switch (e.type) {
    case 'died':
      return `died (${e.cause}) ${formatClock(e.day, e.minuteOfDay)}`;
    case 'wounded':
      return `wounded ${e.part} ${e.wound}`;
    case 'moodleChanged':
      return `moodle ${e.moodle} ${e.from}→${e.to}`;
    case 'fellAsleep':
      return 'fell asleep';
    case 'wokeUp':
      return `woke up (${e.reason})`;
    case 'timeScaleHint':
      return `time scale hint ×${e.speed}`;
    case 'dayPassed':
      return `day ${e.day}`;
    case 'commandRejected':
      return `command ${e.seq} rejected (${e.reason})`;
    case 'actionStarted':
      return `action ${e.action} → tick ${e.endTick}`;
    case 'actionCompleted':
      return `action ${e.action} done`;
    case 'actionInterrupted':
      return `action ${e.action} interrupted (${e.reason})`;
    case 'containerOpened':
      return `container ${e.container} opened${e.firstSearch ? ' (searched)' : ''}`;
    case 'itemUsed':
      return `used ${e.itemId}${e.freshness ? ` (${e.freshness})` : ''}`;
  }
}

const stat = (s: GameState, id: 'health' | 'hunger' | 'thirst' | 'fatigue') =>
  s.player.stats[id]?.toFixed(0) ?? '–';

/** Dev overlay line: clock, key stats, moodles, last event or error. */
export function devStateLine(s: GameState): string {
  if (s.status === 'error') return `sim error: ${s.error ?? ''}`;
  if (!s.clock) return 'survival: off (no view)';
  const moodles = Object.entries(s.player.moodles)
    .map(([id, lvl]) => `${id.replace(/^base:/, '')}${lvl}`)
    .join(' ');
  const last = s.recentEvents[s.recentEvents.length - 1];
  return [
    `${formatClock(s.clock.day, s.clock.minuteOfDay)} · hp ${stat(s, 'health')} hun ${stat(s, 'hunger')} thr ${stat(s, 'thirst')} fat ${stat(s, 'fatigue')}${s.player.alive ? '' : ' · DEAD'}${s.player.sleeping ? ' · asleep' : ''}`,
    `moodles: ${moodles || '–'} · wounds ${s.player.wounds.length}${last ? ` · last: ${describeEvent(last)}` : ''}`,
  ].join('\n');
}
