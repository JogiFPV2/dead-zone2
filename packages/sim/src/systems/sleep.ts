import type { CommandRejectReason, WakeReason } from '@deadzone/protocol';
import { gameMinuteAt, MINUTES_PER_DAY, minuteOfDay } from '../core/clock.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { CHUNK_SIZE } from '@deadzone/protocol';
import { TICKS_PER_SECOND } from '../core/constants.js';
import {
  clampStat,
  moodleLevel,
  SLEEP_SURFACES,
  type SleepSurface,
  type SurvivalWorld,
} from '../survival/state.js';
import { floorZ } from '../world/levels.js';
import { objectRect } from '../furniture/footprint.js';
import { rectDist2 } from '../world/furniture.js';

/**
 * A zombie chases the player or is within `sleep.wakeOnZombieTiles` (computed by `ai.threat`
 * after movement of the previous tick): blocks sleep, speed-up and timed actions.
 */
export function threatNearby(w: SimWorld, eid: number): boolean {
  const t = w.ai?.threat.get(eid);
  return t !== undefined && (t.chasing > 0 || t.near > 0);
}

/** Quarter-ticks of real time per tick at speed-up `scale` (×1: 4, ×2: 2, ×4: 1). */
export const realQPerTick = (scale: number): number => (scale === 4 ? 1 : scale === 2 ? 2 : 4);

/** Real seconds of the current sleep (from `sleepRealQ`). */
export const sleepRealSec = (s: SurvivalWorld, eid: number): number =>
  (s.sleepRealQ[eid] ?? 0) / (4 * TICKS_PER_SECOND);

/** Fatigue the current sleeping place gives at most in one sleep (bed 50, sofa 35, floor 25). */
export function restCapOf(s: SurvivalWorld, eid: number): number {
  const surf = SLEEP_SURFACES[s.sleepSurface[eid] ?? 0] ?? 'floor';
  return s.content.survival.sleep.surfaces[surf].maxRecoveryPerSleep;
}

/**
 * Pipeline step 14 (per game minute): fatigue recovery while asleep, quality × pain / cold,
 * limit per sleep by place, waking when rested or after `maxDurationMin`. Every tick: pain /
 * fever wake up; real time asleep grows by 1 / (20 × `timeScale`) s and an uninterrupted
 * `saveAfterRealSec` emits `sleepSaved` once (the host saves; the sim does no IO).
 */
export function sleepSystem(w: SimWorld, first: number, count: number): void {
  const s = w.survival;
  if (!s) return;
  const cfg = s.content.survival.sleep;
  // Same rule as the worker's speed lock (`fastForwardBlocked`): a threat forces ×1.
  const p0 = w.players.get(0);
  if (s.timeScale !== 1 && p0 !== undefined && threatNearby(w, p0)) s.timeScale = 1;
  const saveQ = Math.max(1, Math.round(cfg.saveAfterRealSec * TICKS_PER_SECOND * 4));
  const perTick = realQPerTick(s.timeScale);
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if (s.dead[eid] || !s.asleep[eid]) continue;
    if ((s.vitals.pain[eid] ?? 0) >= cfg.wakeOnPainAbove) {
      wake(w, s, eid, 'pain');
      continue;
    }
    if ((s.vitals['body-temperature-c'][eid] ?? 0) >= cfg.wakeOnFeverC) {
      wake(w, s, eid, 'fever');
      continue;
    }
    s.sleepTicks[eid] = (s.sleepTicks[eid] ?? 0) + 1;
    const q = (s.sleepRealQ[eid] = (s.sleepRealQ[eid] ?? 0) + perTick);
    if (q >= saveQ && !s.sleepSaved[eid]) {
      s.sleepSaved[eid] = 1;
      w.events.push({
        type: 'sleepSaved',
        tick: w.tick,
        playerId: w.c.Player.id[eid] ?? 0,
        fatigueRecovered: Math.round((s.sleepRecovered[eid] ?? 0) * 10) / 10,
        realSec: Math.floor(sleepRealSec(s, eid)),
      });
    }
  }
  for (let m = first; m < first + count; m++) {
    for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
      if (s.dead[eid] || !s.asleep[eid]) continue;
      let quality = 1;
      if ((s.vitals.pain[eid] ?? 0) >= cfg.painAbove) quality *= cfg.painQualityMul;
      if (s.content.coldMoodles.some((i) => moodleLevel(s, eid, i) >= 2))
        quality *= cfg.coldQualityMul;
      const surf = cfg.surfaces[SLEEP_SURFACES[s.sleepSurface[eid] ?? 0] ?? 'floor'];
      const before = s.vitals.fatigue[eid] ?? 0;
      const left = Math.max(0, surf.maxRecoveryPerSleep - (s.sleepRecovered[eid] ?? 0));
      const fatigue = clampStat(before - Math.min(left, surf.fatigueRecoveryPerMin * quality));
      s.vitals.fatigue[eid] = fatigue;
      s.sleepRecovered[eid] = Math.fround((s.sleepRecovered[eid] ?? 0) + (before - fatigue));
      // Alarm (`sleep {until}`): only the alarm (or a threat / pain / fever) wakes.
      const until = s.sleepUntil[eid] ?? 0;
      if (until > 0) {
        if (m >= until) wake(w, s, eid, 'alarm');
        continue;
      }
      // Rested, or this place gave all it can in one sleep (bed 50, sofa 35, floor 25).
      if (
        fatigue <= cfg.wakeAtFatigue ||
        (s.sleepRecovered[eid] ?? 0) >= surf.maxRecoveryPerSleep - 1e-4
      )
        wake(w, s, eid, 'rested');
      else if (m - (s.sleepStart[eid] ?? 0) >= cfg.maxDurationMin) wake(w, s, eid, 'max-duration');
    }
  }
}

export type SleepResult = 'ok' | CommandRejectReason;

/** Why the player cannot fall asleep now (undefined = can): `threat`, `not-tired`. */
export function sleepReason(w: SimWorld, eid: number): CommandRejectReason | undefined {
  const s = w.survival;
  if (!s || s.asleep[eid] || s.dead[eid]) return 'invalid-state';
  if (threatNearby(w, eid)) return 'threat';
  const cfg = s.content.survival.sleep;
  return (s.vitals.fatigue[eid] ?? 0) < cfg.minFatigueToSleep ? 'not-tired' : undefined;
}

/** Absolute alarm minute for `until` from minute `now` (0 = none). */
export function alarmMinute(
  cfg: SurvivalWorld['content']['survival']['sleep'],
  now: number,
  until: 'morning' | number | undefined,
): number {
  if (until === undefined) return 0;
  if (until === 'morning') {
    const at = cfg.morningHour * 60;
    const today = now - minuteOfDay(now) + at;
    return today > now ? today : today + MINUTES_PER_DAY;
  }
  return now + Math.max(1, Math.min(cfg.untilMaxHours, Math.floor(until))) * 60;
}

export function fallAsleep(w: SimWorld, eid: number, until?: 'morning' | number): SleepResult {
  const reason = sleepReason(w, eid);
  if (reason) return reason;
  const s = w.survival!;
  const cfg = s.content.survival.sleep;
  const now = gameMinuteAt(w.clock, w.tick);
  s.asleep[eid] = 1;
  s.sleepStart[eid] = now;
  s.sleepUntil[eid] = alarmMinute(cfg, now, until);
  s.sleepSurface[eid] = SLEEP_SURFACES.indexOf(sleepSurfaceAt(w, eid));
  s.sleepRecovered[eid] = 0;
  s.sleepTicks[eid] = 0;
  s.sleepRealQ[eid] = 0;
  s.sleepSaved[eid] = 0;
  const playerId = w.c.Player.id[eid] ?? 0;
  w.events.push({ type: 'fellAsleep', tick: w.tick, playerId });
  w.events.push({ type: 'timeScaleHint', tick: w.tick, speed: cfg.timeScaleHint });
  return 'ok';
}

export function wake(w: SimWorld, s: SurvivalWorld, eid: number, reason: WakeReason): boolean {
  if (!s.asleep[eid]) return false;
  s.asleep[eid] = 0;
  s.sleepUntil[eid] = 0;
  w.events.push({
    type: 'wokeUp',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    reason,
    restGained: Math.round((s.sleepRecovered[eid] ?? 0) * 10) / 10,
    restCap: restCapOf(s, eid),
    saved: s.sleepSaved[eid] === 1,
  });
  w.events.push({ type: 'timeScaleHint', tick: w.tick, speed: 1 });
  return true;
}

/** Best sleeping place within 1.5 tiles: map objects whose placeable has `sleepSurface`. */
export function sleepSurfaceAt(w: SimWorld, eid: number): SleepSurface {
  return placeAt(w, eid).sleep;
}

/** A seat, sofa or bed within 1.5 tiles (full `rest`). */
export const seatNear = (w: SimWorld, eid: number): boolean => placeAt(w, eid).seat;

function placeAt(w: SimWorld, eid: number): { sleep: SleepSurface; seat: boolean } {
  const content = w.survival?.content;
  if (!content) return { sleep: 'floor', seat: false };
  let seat = false;
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  let best: SleepSurface = 'floor';
  // Furniture footprint: a bed anchored up to 3 tiles further NW still reaches (docs 9.49).
  const back = w.furniture ? 3 : 0;
  const cx0 = Math.floor((px - 2 - back) / CHUNK_SIZE);
  const cx1 = Math.floor((px + 2) / CHUNK_SIZE);
  const cy0 = Math.floor((py - 2 - back) / CHUNK_SIZE);
  const cy1 = Math.floor((py + 2) / CHUNK_SIZE);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (const obj of w.map.getChunk(cx, cy, z)?.objects ?? []) {
        const def = content.items[content.itemIndex.get(obj.contentId) ?? -1];
        if (def?.kind !== 'placeable') continue;
        const surf = def.placeable.sleepSurface;
        if (!surf && !def.placeable.seat) continue;
        const ox = cx * CHUNK_SIZE + obj.x;
        const oy = cy * CHUNK_SIZE + obj.y;
        const d2 = w.furniture
          ? rectDist2(objectRect(w, ox, oy, obj.contentId, obj.rot), px, py)
          : (ox + 0.5 - px) * (ox + 0.5 - px) + (oy + 0.5 - py) * (oy + 0.5 - py);
        if (d2 > 1.5 * 1.5) continue;
        seat = true;
        if (surf && SLEEP_SURFACES.indexOf(surf) > SLEEP_SURFACES.indexOf(best)) best = surf;
      }
    }
  }
  return { sleep: best, seat };
}
