import type { WakeReason } from '@deadzone/protocol';
import { gameMinuteAt } from '../core/clock.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { clampStat, moodleLevel, type SurvivalWorld } from '../survival/state.js';

/**
 * A zombie chases the player or is within `sleep.wakeOnZombieTiles` (computed by `ai.threat`
 * after movement of the previous tick): blocks sleep, speed-up and timed actions.
 */
export function threatNearby(w: SimWorld, eid: number): boolean {
  const t = w.ai?.threat.get(eid);
  return t !== undefined && (t.chasing > 0 || t.near > 0);
}

/**
 * Pipeline step 14 (per game minute): fatigue recovery while asleep (floor for now; beds come
 * with furniture), quality × pain / cold, waking when rested or after `maxDurationMin`.
 */
export function sleepSystem(w: SimWorld, first: number, count: number): void {
  const s = w.survival;
  if (!s) return;
  const cfg = s.content.survival.sleep;
  for (let m = first; m < first + count; m++) {
    for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
      if (s.dead[eid] || !s.asleep[eid]) continue;
      let quality = 1;
      if ((s.vitals.pain[eid] ?? 0) >= cfg.painAbove) quality *= cfg.painQualityMul;
      if (s.content.coldMoodles.some((i) => moodleLevel(s, eid, i) >= 2))
        quality *= cfg.coldQualityMul;
      const fatigue = clampStat(
        (s.vitals.fatigue[eid] ?? 0) - cfg.surfaces.floor.fatigueRecoveryPerMin * quality,
      );
      s.vitals.fatigue[eid] = fatigue;
      if (fatigue <= cfg.wakeAtFatigue) wake(w, s, eid, 'rested');
      else if (m - (s.sleepStart[eid] ?? 0) >= cfg.maxDurationMin) wake(w, s, eid, 'max-duration');
    }
  }
}

export type SleepResult = 'ok' | 'invalid-state';

export function fallAsleep(w: SimWorld, eid: number): SleepResult {
  const s = w.survival;
  if (!s || s.asleep[eid] || threatNearby(w, eid)) return 'invalid-state';
  const cfg = s.content.survival.sleep;
  if ((s.vitals.fatigue[eid] ?? 0) < cfg.minFatigueToSleep) return 'invalid-state';
  s.asleep[eid] = 1;
  s.sleepStart[eid] = gameMinuteAt(w.clock, w.tick);
  const playerId = w.c.Player.id[eid] ?? 0;
  w.events.push({ type: 'fellAsleep', tick: w.tick, playerId });
  w.events.push({ type: 'timeScaleHint', tick: w.tick, speed: cfg.timeScaleHint });
  return 'ok';
}

export function wake(w: SimWorld, s: SurvivalWorld, eid: number, reason: WakeReason): boolean {
  if (!s.asleep[eid]) return false;
  s.asleep[eid] = 0;
  w.events.push({ type: 'wokeUp', tick: w.tick, playerId: w.c.Player.id[eid] ?? 0, reason });
  w.events.push({ type: 'timeScaleHint', tick: w.tick, speed: 1 });
  return true;
}
