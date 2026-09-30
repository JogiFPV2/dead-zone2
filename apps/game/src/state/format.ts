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
      return `died (${e.cause}) ${formatClock(e.day, e.minuteOfDay)}, survived ${e.daysSurvived ?? 0} days, ${e.zombiesKilled ?? 0} kills`;
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
    case 'noise':
      return `noise ${e.source} r${e.radiusTiles.toFixed(1)} at ${e.x.toFixed(1)},${e.y.toFixed(1)}`;
    case 'zombieAlerted':
      return `zombie ${e.zombie} alerted (${e.reason})`;
    case 'hit':
      return `hit ${e.source} ${e.attacker} → ${e.target} ${e.damage.toFixed(1)}${e.killed ? ' (killed)' : ''}`;
    case 'zombieKilled':
      return `zombie ${e.zombie} killed`;
    case 'weaponBroke':
      return `weapon broke: ${e.itemId}`;
    case 'itemUsed':
      return `used ${e.itemId}${e.freshness ? ` (${e.freshness})` : ''}`;
  }
}

const stat = (s: GameState, id: 'health' | 'hunger' | 'thirst' | 'fatigue') =>
  s.player.stats[id]?.toFixed(0) ?? '–';

const short = (id: string | undefined) => (id ?? '?').replace(/^base:/, '');

/**
 * Compact items line: `inv 2.5/12kg 3it · near 2 crate fridge* · open fridge 4it · search 40% +1`
 * (`*` = already searched, `+N` = queued actions).
 */
export function devItemsLine(s: GameState): string {
  const inv = s.inventory;
  const count = inv ? Object.values(inv.containers).reduce((n, c) => n + c.items.length, 0) : 0;
  const parts = [
    inv ? `inv ${inv.loadKg.toFixed(1)}/${inv.capacityKg.toFixed(0)}kg ${count}it` : 'inv –',
    `near ${s.nearby.length}${s.nearby
      .slice(0, 4)
      .map((c) => ` ${c.kind === 'ground' ? 'ground' : short(c.type)}${c.searched ? '*' : ''}`)
      .join('')}${s.nearby.length > 4 ? ' …' : ''}`,
  ];
  if (s.container) {
    parts.push(`open ${short(s.container.type ?? s.container.kind)} ${s.container.items.length}it`);
  }
  const a = s.action;
  if (a) {
    const span = Math.max(1, a.endTick - a.startTick);
    const pct = Math.round(Math.min(1, Math.max(0, (s.tick - a.startTick) / span)) * 100);
    parts.push(`${a.kind} ${pct}%${a.queued > 0 ? ` +${a.queued}` : ''}`);
  }
  return parts.join(' · ');
}

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
    devItemsLine(s),
  ].join('\n');
}
