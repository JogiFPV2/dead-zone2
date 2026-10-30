import { topEntry } from '../physics/stairs.js';
import { GAITS } from '@deadzone/protocol';
import { DEFAULT_STAGE4_CONFIG } from '../ai/config.js';
import { ModSlot } from '../content/adapter.js';
import { atan2Bam } from '../core/dmath.js';
import { modded } from '../survival/state.js';
import { Pen, penalty } from '../survival/penalties.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { circleContacts, moveCircle, slideCircle, type Vec2 } from '../world/collision.js';
import { ZombieState } from '../ai/state.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import {
  GAIT_PROFILES,
  LOCO_SPEED_MPS,
  SPRINT_MIN_ENDURANCE,
  SPRINT_SPEED_MUL,
} from '../physics/constants.js';
import { locomotionStep, projectOnContacts, type LocoOut } from '../physics/locomotion.js';
import { EF } from '../openings/state.js';
import { bodyOf, gaitSeedOf, physicsCanRun } from '../physics/system.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';

const tmp: Vec2 = { x: 0, y: 0 };

/**
 * Players: jerk-limited locomotion per gait (sneak / walk / run / sprint, `physics/locomotion.ts`,
 * constants in `physics/constants.ts`): S-curve acceleration and braking without overshoot,
 * the movement direction turns slower the faster the body goes, a reversal brakes first, and the
 * move slides along walls (`slideCircle`: substeps, contact normals, tangent projection of the
 * target and the velocity). Zombies and animals: full speed after `ACCEL_TICKS` (0.2 s), stop
 * after `DECEL_TICKS` (0.15 s), plain `moveCircle`. Facing (players) turns at most `TURN_BAM_PER_TICK` (720°/s) towards
 * the aim / movement direction, so the body can face one way and walk another (backwards,
 * strafing). Zombies: speed × a smooth, deterministic wobble (±`ZOMBIE_WOBBLE`, new key every
 * `WOBBLE_PERIOD_TICKS`) from the zombie's physics `gaitSeed`, and the same rise / brake as the
 * player scaled by their (lower) inertia multiplier. Physics (`physics/system.ts`) plugs in as a
 * movement modifier: load, endurance and mass, and no control while knocked down.
 */
export const ACCEL_TICKS = 4;
export const DECEL_TICKS = 3;
export const TURN_BAM_PER_TICK = Math.round((720 / 360 / 20) * 65536);
export const ZOMBIE_WOBBLE = 0.2;
export const WOBBLE_PERIOD_TICKS = 12;

/** Integer hash → [0, 1). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Zombie pace multiplier at `tick`: 1 ± ZOMBIE_WOBBLE, smoothstep between keys of `gaitSeed`. */
export function zombieWobble(gaitSeed: number, tick: number): number {
  const k = Math.floor(tick / WOBBLE_PERIOD_TICKS);
  const t = (tick - k * WOBBLE_PERIOD_TICKS) / WOBBLE_PERIOD_TICKS;
  const a = hash01(gaitSeed, k);
  const b = hash01(gaitSeed, k + 1);
  const s = t * t * (3 - 2 * t);
  return Math.fround(1 + ZOMBIE_WOBBLE * (2 * (a + (b - a) * s) - 1));
}

/** Moves (vx, vy) towards (tx, ty) by at most `step` (f32). */
function approach(vx: number, vy: number, tx: number, ty: number, step: number, out: Vec2): void {
  const dx = tx - vx;
  const dy = ty - vy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= step || len === 0) {
    out.x = tx;
    out.y = ty;
  } else {
    out.x = Math.fround(vx + (dx * step) / len);
    out.y = Math.fround(vy + (dy * step) / len);
  }
}
const vel: Vec2 = { x: 0, y: 0 };
const push: Vec2 = { x: 0, y: 0 };

/**
 * Extension point for later systems (physics: mass, load, knock-down, pushing doors): per-entity
 * multipliers applied every tick, in registration order. `speedMul` scales the target speed of
 * players and zombies; `accelMul` scales the acceleration / braking step (0 = cannot
 * change velocity this tick). Register once at module init (like action handlers). Physics
 * registers `physicsMovementModifier` in `createSim`.
 */
export interface MovementModifier {
  speedMul?(w: SimWorld, eid: number): number;
  accelMul?(w: SimWorld, eid: number): number;
  /** Extra displacement this tick (tiles, e.g. a crowd push), swept with the move; false = none. */
  push?(w: SimWorld, eid: number, out: Vec2): boolean;
  /**
   * Performs the move (dx, dy) itself (collisions included) and writes the position to `out`;
   * false = not handled (plain `moveCircle` on `floorZ`). Physics: stairs and level changes.
   */
  move?(w: SimWorld, grid: TileGrid, eid: number, dx: number, dy: number, out: Vec2): boolean;
}
const modifiers: MovementModifier[] = [];
export function registerMovementModifier(m: MovementModifier): void {
  if (!modifiers.includes(m)) modifiers.push(m);
}
function hookedMove(w: SimWorld, grid: TileGrid, eid: number, dx: number, dy: number): boolean {
  for (const m of modifiers) if (m.move?.(w, grid, eid, dx, dy, tmp)) return true;
  return false;
}
function modMul(w: SimWorld, eid: number, key: 'speedMul' | 'accelMul'): number {
  let f = 1;
  for (const m of modifiers) f *= m[key]?.(w, eid) ?? 1;
  return f;
}

/** Pipeline step 4: intent → velocity (tiles per tick) → collisions → position. */
export function movementSystem(w: SimWorld, grid: TileGrid): void {
  const { Position, Velocity, MoveIntent, MoveStats, Collider } = w.c;
  for (const eid of sortedQuery(w, 'movement', [
    Position,
    Velocity,
    MoveIntent,
    MoveStats,
    Collider,
  ])) {
    const s = w.survival;
    let speed = MoveStats.speedPerTick[eid] ?? 0;
    const zombie = w.c.Zombie.is[eid] === 1;
    const animal = w.c.Animal.is[eid] === 1;
    const player = !zombie && !animal;
    let gaitIdx = 1;
    if (zombie) {
      // Zombies: speed set by ai.locomotion, no survival modifiers; a shambling wobble.
      speed = Math.fround(speed * zombieWobble(gaitSeedOf(w, eid), w.tick));
      gaitIdx = w.c.Zombie.state[eid] === ZombieState.chase ? 2 : 1;
    } else if (animal) {
      // Animals: speed set by the `animals` step (graze / wander / flee), nothing else.
    } else if (s && (s.asleep[eid] || s.dead[eid])) {
      // Asleep or dead: no movement (the held intent stays for after waking).
      speed = 0;
    } else {
      const gait = effectiveGait(w, eid);
      gaitIdx = GAITS.indexOf(gait);
      speed = Math.fround(speed * gaitSpeedMul(w, gait));
      if (s) {
        speed = Math.fround(
          modded(s, eid, ModSlot['move-speed'], speed) *
            (s.bagSpeed[eid] ?? 1) *
            (1 - penalty(s, eid, Pen.move)),
        );
      }
    }
    MoveStats.gait[eid] = gaitIdx;
    // Climbing through an open / broken window: slower (players and zombies).
    if (speed > 0 && nearSlowEdge(grid, eid, w)) {
      speed = Math.fround(speed * w.openings.cfg.windowSpeedMul);
    }
    if (modifiers.length > 0) speed = Math.fround(speed * modMul(w, eid, 'speedMul'));
    const px = Velocity.x[eid] ?? 0;
    const py = Velocity.y[eid] ?? 0;
    let vx = Math.fround((MoveIntent.dx[eid] ?? 0) * speed);
    let vy = Math.fround((MoveIntent.dy[eid] ?? 0) * speed);
    const accel = speed > 0 && modifiers.length > 0 ? modMul(w, eid, 'accelMul') : 1;
    const z = floorZ(w, eid);
    const r = Collider.radius[eid] ?? 0;
    if (speed <= 0) {
      MoveStats.accel[eid] = 0;
    } else if (player) {
      // Players: jerk-limited locomotion in m/s, target and velocity slid along touching walls.
      // At the top of a flight the missing floor over it is an edge contact; walking down onto
      // the flight must not be cancelled by it (a body stopped against that edge stayed stuck).
      const x0 = Position.x[eid] ?? 0;
      const y0 = Position.y[eid] ?? 0;
      const onStairs =
        (bodyOf(w, eid)?.stair ?? 0) > 0 ||
        (w.physics.stairs.length > 0 && topEntry(grid, x0, y0, z, vx, vy, r) !== undefined);
      if (onStairs) normals.length = 0;
      else circleContacts(grid, z, Position.x[eid] ?? 0, Position.y[eid] ?? 0, r, normals);
      // Profiles are tuned for the default walk (1.5 m/s); another `walkSpeedMps` scales them
      // (same times and turning, tests with a fast walk stay "teleports").
      const k = ((MoveStats.speedPerTick[eid] ?? 0) * TPS) / LOCO_SPEED_MPS.walk || 1;
      const u = TPS / k;
      projectOnContacts(vx * u, vy * u, normals, tv);
      projectOnContacts(px * u, py * u, normals, cv);
      locomotionStep(
        cv.x,
        cv.y,
        (MoveStats.accel[eid] ?? 0) / k,
        tv.x,
        tv.y,
        GAIT_PROFILES[GAITS[gaitIdx] ?? 'walk'],
        accel,
        loco,
      );
      vx = Math.fround(loco.vx / u);
      vy = Math.fround(loco.vy / u);
      MoveStats.accel[eid] = Math.fround(loco.a * k);
    } else {
      const speeding = vx * vx + vy * vy >= px * px + py * py;
      approach(px, py, vx, vy, (speed * accel) / (speeding ? ACCEL_TICKS : DECEL_TICKS), vel);
      vx = vel.x;
      vy = vel.y;
    }
    Velocity.x[eid] = vx;
    Velocity.y[eid] = vy;
    let mx = vx;
    let my = vy;
    for (const m of modifiers) {
      if (m.push?.(w, eid, push)) {
        mx += push.x;
        my += push.y;
      }
    }
    if (mx !== 0 || my !== 0) {
      // A modifier may own the move (physics: stairs, level edges); else the plain sweep
      // (players: substepped sliding with contact normals).
      if (!hookedMove(w, grid, eid, mx, my)) {
        const x0 = Position.x[eid] ?? 0;
        const y0 = Position.y[eid] ?? 0;
        if (player) {
          slideCircle(grid, z, x0, y0, mx, my, r, tmp, normals);
          if (normals.length > 0) {
            projectOnContacts(vx, vy, normals, cv);
            Velocity.x[eid] = vx = Math.fround(cv.x);
            Velocity.y[eid] = vy = Math.fround(cv.y);
          }
        } else moveCircle(grid, z, x0, y0, mx, my, r, tmp);
      }
      Position.x[eid] = tmp.x;
      Position.y[eid] = tmp.y;
    }
    // Realised longitudinal acceleration (m/s², snapshot): Δ|v| per tick.
    const before = Math.sqrt(px * px + py * py);
    const after = Math.sqrt(vx * vx + vy * vy);
    MoveStats.longAccel[eid] = Math.fround((after - before) * TPS * TPS);
    if (after === 0 && (MoveStats.accel[eid] ?? 0) < 0) MoveStats.accel[eid] = 0;
  }
}

const TPS = TICKS_PER_SECOND;
const normals: number[] = [];
const tv: Vec2 = { x: 0, y: 0 };
const cv: Vec2 = { x: 0, y: 0 };
const loco: LocoOut = { vx: 0, vy: 0, a: 0, accel: 0 };

/** Target speed × walk for a gait (data: sneak / run multipliers; sprint = run × 1.3). */
export function gaitSpeedMul(w: SimWorld, gait: (typeof GAITS)[number]): number {
  if (gait === 'walk') return 1;
  const g = (w.ai?.cfg ?? DEFAULT_STAGE4_CONFIG).gait;
  if (gait === 'sneak') return g.sneakSpeedMul;
  return gait === 'sprint' ? g.runSpeedMul * SPRINT_SPEED_MUL : g.runSpeedMul;
}

/** The entity's circle touches an open / broken window edge of its tile. */
function nearSlowEdge(grid: TileGrid, eid: number, w: SimWorld): boolean {
  if (w.openings.states.size === 0) return false;
  const x = w.c.Position.x[eid] ?? 0;
  const y = w.c.Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const r = (w.c.Collider.radius[eid] ?? 0) + 0.05;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const slow = (f: number): boolean => (f & EF.slow) !== 0;
  return (
    (x - tx < r && slow(grid.flagsW(tx, ty, z))) ||
    (tx + 1 - x < r && slow(grid.flagsW(tx + 1, ty, z))) ||
    (y - ty < r && slow(grid.flagsN(tx, ty, z))) ||
    (ty + 1 - y < r && slow(grid.flagsN(tx, ty + 1, z)))
  );
}

/**
 * Facing after movement: towards the aim point when the entity has aimed at least once,
 * otherwise along the movement direction. Uses the deterministic atan2 (see core/dmath.ts).
 */
export function facingSystem(w: SimWorld): void {
  const { Position, Facing, AimIntent, Velocity } = w.c;
  for (const eid of sortedQuery(w, 'facing', [Position, Facing, AimIntent, Velocity])) {
    let dx: number;
    let dy: number;
    if (AimIntent.active[eid]) {
      dx = (AimIntent.x[eid] ?? 0) - (Position.x[eid] ?? 0);
      dy = (AimIntent.y[eid] ?? 0) - (Position.y[eid] ?? 0);
    } else {
      dx = Velocity.x[eid] ?? 0;
      dy = Velocity.y[eid] ?? 0;
    }
    if (dx === 0 && dy === 0) continue;
    const target = atan2Bam(dy, dx);
    if (!isPlayer(w, eid)) {
      Facing.angle[eid] = target;
      continue;
    }
    const cur = Facing.angle[eid] ?? 0;
    let diff = (target - cur) & 0xffff;
    if (diff > 32768) diff -= 65536;
    const step = Math.max(-TURN_BAM_PER_TICK, Math.min(TURN_BAM_PER_TICK, diff));
    Facing.angle[eid] = (cur + step) & 0xffff;
  }
}

const isPlayer = (w: SimWorld, eid: number): boolean =>
  w.players.get(w.c.Player.id[eid] ?? -1) === eid;

/**
 * Gait of a player this tick: `sprint` needs endurance ≥ `SPRINT_MIN_ENDURANCE` (else runs),
 * `run` needs endurance > 0 (with survival) and not being exhausted (physics: endurance level 4),
 * else walks.
 */
export function effectiveGait(w: SimWorld, eid: number): (typeof GAITS)[number] {
  let gait = GAITS[w.c.MoveIntent.gait[eid] ?? 1] ?? 'walk';
  if (gait === 'sprint') {
    const e = w.survival ? (w.survival.vitals.endurance[eid] ?? 0) : 100;
    if (e < SPRINT_MIN_ENDURANCE) gait = 'run';
    else if (!physicsCanRun(w, eid)) return 'walk';
    else return 'sprint';
  }
  if (gait === 'run' && w.survival && (w.survival.vitals.endurance[eid] ?? 0) <= 0) return 'walk';
  if (gait === 'run' && !physicsCanRun(w, eid)) return 'walk';
  return gait;
}
