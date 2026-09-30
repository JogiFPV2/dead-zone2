import { dayOf, gameMinuteAt, minuteOfDay } from '../core/clock.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { DEATH_CAUSES } from '../survival/state.js';
import { wake } from './sleep.js';

/**
 * Pipeline step 17: player death (permadeath). HP ≤ 0 → dead, intents cleared, `died` event with
 * the cause chosen by `health` and the game day for the death screen.
 */
export function lifecycleSystem(w: SimWorld): void {
  const s = w.survival;
  if (!s) return;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if (s.dead[eid] || (s.vitals.health[eid] ?? 0) > 0) continue;
    s.dead[eid] = 1;
    wake(w, s, eid, 'died');
    w.c.MoveIntent.dx[eid] = 0;
    w.c.MoveIntent.dy[eid] = 0;
    w.c.Velocity.x[eid] = 0;
    w.c.Velocity.y[eid] = 0;
    const minute = gameMinuteAt(w.clock, w.tick);
    w.events.push({
      type: 'died',
      tick: w.tick,
      playerId: w.c.Player.id[eid] ?? 0,
      cause: DEATH_CAUSES[s.cause[eid] ?? 0] ?? 'wounds',
      day: dayOf(minute),
      minuteOfDay: minuteOfDay(minute),
    });
  }
}
