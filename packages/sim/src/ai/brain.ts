import { atan2Bam } from '../core/dmath.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { lineOfSight, walkableLine } from '../world/los.js';
import type { TileGrid } from '../world/grid.js';
import { floorOf } from './floors.js';
import { heard } from './noise.js';
import { ZombieState, type AiWorld, type Noise } from './state.js';
import { currentDaylight, playerVisibility } from './vision.js';
import { secToTicks } from './zombies.js';
import { floorZ } from '../world/levels.js';

/**
 * Pipeline `ai.perception` + `ai.brain` (docs 2.5 `ai`). Zombies think every
 * `ai.thinkEveryTicks` (spread by StableId), far from every player only every
 * `ai.farThinkEveryTicks` and without sight. Sight: range = type `sightRangeTiles` × target
 * visibility (daylight / lights / dark zones / sneaking, see vision.ts), a cone around the facing
 * (all around closer than `nearSenseTiles`), line of sight over edges. Hearing: loudest noise of
 * the last think interval within the damped radius (noise.ts). FSM: idle ↔ wander, investigate
 * (noise), chase (sees a player), search (lost the target), then wander again. Sight stays on
 * the zombie's floor (no seeing through ceilings); hearing reaches other floors (noise.ts), the
 * goal floor goes to `Zombie.tz` (ai/floors.ts).
 *
 * Losing the track (`worldSettings.ai`): seeing the target or hearing a noise at its position
 * (within `HEAR_TARGET_TILES`) refreshes `memoryUntil` = now + `lostTrackSec` and the last known
 * spot (`tx`/`ty`). The chase ends only when that memory ran out AND the target is farther than
 * `lostTrackDistTiles` (or on another floor, or dead); closer, a zombie that reached the last
 * known spot picks up the trail at the player's position. A lost chase becomes `search`: walk to
 * the last known spot (`stateTick` 0), look around there for `searchSec`, then idle / wander.
 */

/** A heard noise this close to the chased player counts as hearing the player (footsteps, shots). */
export const HEAR_TARGET_TILES = 2;

interface Target {
  eid: number;
  sid: number;
  x: number;
  y: number;
  z: number;
  vis: number;
}

const targets: Target[] = [];

export function aiThinkSystem(w: SimWorld, grid: TileGrid): void {
  const ai = w.ai;
  if (!ai || ai.zombieCount === 0) return;
  const { Position, StableId, Zombie } = w.c;
  const cfg = ai.cfg.ai;

  // Players as sight targets, with their visibility this tick.
  targets.length = 0;
  ai.visibility.clear();
  const day = currentDaylight(w, ai.cfg.vision);
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    const vis = playerVisibility(w, ai, eid, day);
    ai.visibility.set(eid, vis);
    if (w.survival?.dead[eid]) continue;
    targets.push({
      eid,
      sid: StableId.value[eid] ?? 0,
      x: Position.x[eid] ?? 0,
      y: Position.y[eid] ?? 0,
      z: floorZ(w, eid),
      vis,
    });
  }

  // Spatial hash of zombies at their current positions (separation, threat).
  ai.spatial.clear();
  const zombies = sortedQuery(w, 'zombies', [Zombie]);
  for (const eid of zombies) ai.spatial.insert(eid, Position.x[eid] ?? 0, Position.y[eid] ?? 0);

  const far2 = cfg.farTiles * cfg.farTiles;
  for (const eid of zombies) {
    const sid = StableId.value[eid] ?? 0;
    const x = Position.x[eid] ?? 0;
    const y = Position.y[eid] ?? 0;
    const z = floorZ(w, eid);
    let near = false;
    for (const t of targets) {
      const dx = t.x - x;
      const dy = t.y - y;
      if (t.z === z && dx * dx + dy * dy <= far2) near = true;
    }
    const every = near ? cfg.thinkEveryTicks : cfg.farThinkEveryTicks;
    if ((w.tick + sid) % every === 0) think(w, ai, grid, eid, x, y, z, near, every);
    brain(w, ai, grid, eid, x, y);
  }
}

function think(
  w: SimWorld,
  ai: AiWorld,
  grid: TileGrid,
  eid: number,
  x: number,
  y: number,
  z: number,
  near: boolean,
  every: number,
): void {
  const { Zombie, Facing } = w.c;
  const t = ai.types[Zombie.type[eid] ?? 0]!;
  const vcfg = ai.cfg.vision;
  const state = Zombie.state[eid] ?? 0;

  // Sight: closest visible player by (distance², StableId).
  let seen: Target | undefined;
  let seenD2 = Infinity;
  if (near) {
    const halfBam = Math.round((vcfg.fovHalfAngleDeg / 360) * 65536);
    const near2 = vcfg.nearSenseTiles * vcfg.nearSenseTiles;
    for (const tg of targets) {
      if (tg.z !== z || tg.vis <= 0) continue;
      const dx = tg.x - x;
      const dy = tg.y - y;
      const d2 = dx * dx + dy * dy;
      const range = t.def.sightRangeTiles * tg.vis;
      // Targets are in StableId order, so on equal distance the lower StableId wins.
      if (d2 > range * range || d2 >= seenD2) continue;
      if (d2 > near2) {
        const diff = (atan2Bam(dy, dx) - (Facing.angle[eid] ?? 0)) & 0xffff;
        if (Math.min(diff, 65536 - diff) > halfBam) continue;
      }
      if (!lineOfSight(grid, z, x, y, tg.x, tg.y)) continue;
      seen = tg;
      seenD2 = d2;
    }
  }
  if (seen) {
    if (state !== ZombieState.chase || Zombie.targetId[eid] !== seen.sid) {
      w.events.push({
        type: 'zombieAlerted',
        tick: w.tick,
        zombie: w.c.StableId.value[eid] ?? 0,
        reason: 'sight',
        x: Math.fround(seen.x),
        y: Math.fround(seen.y),
      });
    }
    Zombie.state[eid] = ZombieState.chase;
    Zombie.targetId[eid] = seen.sid;
    Zombie.tx[eid] = Math.fround(seen.x);
    Zombie.ty[eid] = Math.fround(seen.y);
    Zombie.tz[eid] = floorOf(seen.z);
    Zombie.memoryUntil[eid] = w.tick + secToTicks(ai.cfg.ai.lostTrackSec);
    Zombie.alert[eid] = 0;
    ai.direct[eid] = straight(w, ai, grid, eid, z, x, y, seen.x, seen.y);
    return;
  }

  // Hearing the chased player (a noise at its position) keeps the track fresh.
  if (state === ZombieState.chase) {
    const sid = Zombie.targetId[eid] ?? 0;
    const tg = targets.find((c) => c.sid === sid);
    let hit: Noise | undefined;
    for (const n of tg ? ai.noises : []) {
      if (n.tick < w.tick - every || n.z !== floorOf(tg!.z)) continue;
      const dx = n.x - tg!.x;
      const dy = n.y - tg!.y;
      if (dx * dx + dy * dy > HEAR_TARGET_TILES * HEAR_TARGET_TILES) continue;
      if (!heard(ai, grid, n, x, y, z, t.def.hearingRangeTiles)) continue;
      hit = n;
    }
    if (hit) {
      Zombie.tx[eid] = hit.x;
      Zombie.ty[eid] = hit.y;
      Zombie.tz[eid] = hit.z;
      Zombie.memoryUntil[eid] = w.tick + secToTicks(ai.cfg.ai.lostTrackSec);
      ai.direct[eid] = straight(w, ai, grid, eid, z, x, y, hit.x, hit.y);
      return;
    }
  }

  // Hearing (a chase with a fresh memory ignores noises).
  if (state !== ZombieState.chase || w.tick >= (Zombie.memoryUntil[eid] ?? 0)) {
    let best: Noise | undefined;
    for (const n of ai.noises) {
      if (n.tick < w.tick - every) continue;
      if (best && n.volume < best.volume) continue;
      if (!heard(ai, grid, n, x, y, z, t.def.hearingRangeTiles)) continue;
      best = n;
    }
    if (best && (state !== ZombieState.investigate || best.volume >= (Zombie.alert[eid] ?? 0))) {
      if (state !== ZombieState.investigate) {
        w.events.push({
          type: 'zombieAlerted',
          tick: w.tick,
          zombie: w.c.StableId.value[eid] ?? 0,
          reason: 'noise',
          x: best.x,
          y: best.y,
        });
      }
      Zombie.state[eid] = ZombieState.investigate;
      Zombie.targetId[eid] = 0;
      Zombie.tx[eid] = best.x;
      Zombie.ty[eid] = best.y;
      // The source may be on another floor (heard through a ceiling, ai/floors.ts).
      Zombie.tz[eid] = best.z;
      Zombie.alert[eid] = best.volume;
      // stateTick 0 = still walking there; the linger timer starts on arrival. While
      // investigating, `memoryUntil` holds the linger length in ticks of a lure (0 = default).
      Zombie.stateTick[eid] = 0;
      Zombie.memoryUntil[eid] = best.lingerSec > 0 ? secToTicks(best.lingerSec) : 0;
    }
  }
  const s = Zombie.state[eid] ?? 0;
  if (s !== ZombieState.idle) {
    ai.direct[eid] = straight(w, ai, grid, eid, z, x, y, Zombie.tx[eid] ?? 0, Zombie.ty[eid] ?? 0);
  }
}

/** Straight steering allowed: clear line and not stuck (a stuck zombie follows a path). */
function straight(
  w: SimWorld,
  ai: AiWorld,
  grid: TileGrid,
  eid: number,
  z: number,
  x: number,
  y: number,
  gx: number,
  gy: number,
): number {
  if ((w.c.Zombie.stuck[eid] ?? 0) >= ai.cfg.ai.stuckTicks) return 0;
  return walkableLine(grid, z, x, y, gx, gy) ? 1 : 0;
}

const ARRIVE = 0.5;

function arrived(w: SimWorld, eid: number, x: number, y: number): boolean {
  const dx = (w.c.Zombie.tx[eid] ?? 0) - x;
  const dy = (w.c.Zombie.ty[eid] ?? 0) - y;
  return dx * dx + dy * dy <= ARRIVE * ARRIVE;
}

/** Picks a wander goal on a floor tile within `radius` of (cx, cy) (RNG `ai`, 3 tries). */
function pickGoal(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const z = floorZ(w, eid);
  const r = Math.max(1, Math.round(radius));
  for (let i = 0; i < 3; i++) {
    const tx = Math.floor(cx) + w.rng.ai.int(-r, r);
    const ty = Math.floor(cy) + w.rng.ai.int(-r, r);
    if (grid.isVoid(tx, ty, z)) continue;
    w.c.Zombie.tx[eid] = Math.fround(tx + 0.5);
    w.c.Zombie.ty[eid] = Math.fround(ty + 0.5);
    w.c.Zombie.tz[eid] = floorOf(z);
    return true;
  }
  return false;
}

/** Per-tick state timers and transitions (after `think`). */
function brain(w: SimWorld, ai: AiWorld, grid: TileGrid, eid: number, x: number, y: number): void {
  const { Zombie } = w.c;
  const cfg = ai.cfg.ai;
  const rng = w.rng.ai;
  const pause = (): number =>
    w.tick + rng.int(secToTicks(cfg.wanderPauseSec.min), secToTicks(cfg.wanderPauseSec.max));
  switch (Zombie.state[eid]) {
    case ZombieState.idle:
      if (w.tick >= (Zombie.stateTick[eid] ?? 0)) {
        if (pickGoal(w, grid, eid, x, y, cfg.wanderRadiusTiles)) {
          Zombie.state[eid] = ZombieState.wander;
          ai.direct[eid] = straight(
            w,
            ai,
            grid,
            eid,
            floorZ(w, eid),
            x,
            y,
            Zombie.tx[eid] ?? 0,
            Zombie.ty[eid] ?? 0,
          );
        } else Zombie.stateTick[eid] = pause();
      }
      break;
    case ZombieState.wander:
      if (arrived(w, eid, x, y) || (Zombie.stuck[eid] ?? 0) >= cfg.stuckTicks * 3) {
        Zombie.state[eid] = ZombieState.idle;
        Zombie.stateTick[eid] = pause();
        Zombie.stuck[eid] = 0;
      }
      break;
    case ZombieState.investigate:
      if ((Zombie.stateTick[eid] ?? 0) === 0) {
        if (arrived(w, eid, x, y) || (Zombie.stuck[eid] ?? 0) >= cfg.stuckTicks * 3) {
          const linger = Zombie.memoryUntil[eid] ?? 0;
          Zombie.stateTick[eid] =
            w.tick +
            (linger > 0
              ? linger
              : rng.int(
                  secToTicks(cfg.investigateLingerSec.min),
                  secToTicks(cfg.investigateLingerSec.max),
                ));
          Zombie.stuck[eid] = 0;
        }
      } else if (w.tick >= (Zombie.stateTick[eid] ?? 0)) {
        Zombie.state[eid] = ZombieState.idle;
        Zombie.alert[eid] = 0;
        Zombie.memoryUntil[eid] = 0;
        Zombie.stateTick[eid] = pause();
      }
      break;
    case ZombieState.chase: {
      const target = findPlayer(w, Zombie.targetId[eid] ?? 0);
      const dead = target === undefined || w.survival?.dead[target] === 1;
      const sensed = w.tick < (Zombie.memoryUntil[eid] ?? 0);
      const close = !dead && onTrail(w, eid, target, x, y);
      if (dead || (!sensed && !close)) loseTrack(w, eid);
      else if (arrived(w, eid, x, y) && !seesNow(w, eid)) {
        if (close) {
          // Within lostTrackDistTiles the trail goes on: head for the player again.
          const { Position } = w.c;
          Zombie.tx[eid] = Math.fround(Position.x[target] ?? 0);
          Zombie.ty[eid] = Math.fround(Position.y[target] ?? 0);
          Zombie.tz[eid] = floorOf(Position.z[target] ?? 0);
        } else loseTrack(w, eid);
      }
      break;
    }
    case ZombieState.search:
      if ((Zombie.stateTick[eid] ?? 0) === 0) {
        // Walking to the last known spot; the look-around timer starts there.
        if (arrived(w, eid, x, y) || (Zombie.stuck[eid] ?? 0) >= cfg.stuckTicks * 3) {
          Zombie.stateTick[eid] = w.tick + secToTicks(cfg.searchSec);
          Zombie.stuck[eid] = 0;
        }
      } else if (w.tick >= (Zombie.stateTick[eid] ?? 0)) {
        Zombie.state[eid] = ZombieState.idle;
        Zombie.stateTick[eid] = pause();
      } else if (arrived(w, eid, x, y)) {
        pickGoal(w, grid, eid, x, y, 3);
      }
      break;
  }
}

/** Chase lost: walk to the last known spot (`tx`/`ty`), then look around (`search`). */
function loseTrack(w: SimWorld, eid: number): void {
  const { Zombie } = w.c;
  Zombie.state[eid] = ZombieState.search;
  Zombie.stateTick[eid] = 0;
  Zombie.targetId[eid] = 0;
  Zombie.stuck[eid] = 0;
}

/** The chased player is on the zombie's floor within `lostTrackDistTiles` (trail not lost). */
function onTrail(w: SimWorld, eid: number, target: number, x: number, y: number): boolean {
  const { Position } = w.c;
  if (floorOf(Position.z[target] ?? 0) !== floorOf(Position.z[eid] ?? 0)) return false;
  const d = w.ai!.cfg.ai.lostTrackDistTiles;
  const dx = (Position.x[target] ?? 0) - x;
  const dy = (Position.y[target] ?? 0) - y;
  return dx * dx + dy * dy <= d * d;
}

/** Target seen at the last think (memory refreshed within one think interval). */
function seesNow(w: SimWorld, eid: number): boolean {
  const ai = w.ai!;
  const mem = secToTicks(ai.cfg.ai.lostTrackSec);
  return (w.c.Zombie.memoryUntil[eid] ?? 0) - w.tick > mem - ai.cfg.ai.thinkEveryTicks;
}

export function findPlayer(w: SimWorld, sid: number): number | undefined {
  if (sid === 0) return undefined;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if (w.c.StableId.value[eid] === sid) return eid;
  }
  return undefined;
}
