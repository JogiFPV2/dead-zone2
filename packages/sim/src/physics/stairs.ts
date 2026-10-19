import type { SimEvent } from '@deadzone/protocol';
import { ZombieState } from '../ai/state.js';
import { killZombieByWorld } from '../combat/system.js';
import type { SimWorld } from '../core/world.js';
import { clampStat, deathCauseIndex, woundKindIndex } from '../survival/state.js';
import { inflictWound } from '../survival/wounds.js';
import { moveCircle, slideCircle } from '../world/collision.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ, hasFloor, stairLocal, stairWorld, stairZ, type Stair } from '../world/levels.js';
import { canAct, canMove, enduranceLevel, loadLevel } from './modifiers.js';
import { kill, setState } from './reactions.js';
import { sortedBodies } from './step.js';
import type { PhysicsBody, PhysicsEvent, PhysicsWorld } from './types.js';

/**
 * Levels in the physics module: moving on stairs (`physicsLevelMove`, the movement hook),
 * falling over a level edge (`startFalls` / `fallSystem`), dominoes down a flight
 * (`stairDomino`) and zombies pushing up a flight on a player (`stairPushSystem`).
 *
 * On a flight the body moves in its own corridor (one tile wide, `along` 0..len): the map's
 * walls are not used there, so walls of the lower level under the top of the flight do not get
 * in the way; z = base + along / len. Off the flights everything collides per level (`floorZ`).
 * Bodies not on a flight cannot step onto one except through its entrance (bottom edge) or from
 * the top (the exit tile on the level above, walking down).
 */

const body = (w: SimWorld, eid: number): PhysicsBody | undefined =>
  w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);

export const stairOf = (w: SimWorld, b: PhysicsBody): Stair | undefined =>
  b.stair > 0 ? w.physics.stairs[b.stair - 1] : undefined;

/**
 * Positions along a flight already moved this tick (body id → along). Body `x`/`y` are synced
 * only in the `physics` step, so without this two bodies entering a flight in the same tick see
 * each other's old (off-flight) position and can end side by side. The movement system moves
 * bodies in a fixed order, so the first mover claims the entrance and the next one queues
 * `spacing` behind it (deterministic). Transient per tick (not saved, not hashed).
 */
const movedOnStairs = new WeakMap<PhysicsWorld, { tick: number; along: Map<number, number> }>();
function movedThisTick(w: SimWorld): Map<number, number> {
  let m = movedOnStairs.get(w.physics);
  if (!m) movedOnStairs.set(w.physics, (m = { tick: w.tick, along: new Map() }));
  if (m.tick !== w.tick) {
    m.tick = w.tick;
    m.along.clear();
  }
  return m.along;
}

/** The flight's corridor around `along` (with the body radius at both ends). */
const inZone = (s: Stair, along: number, across: number, r: number): boolean =>
  along > -r && along < s.len + r && across > -r && across < 1 + r;

/** Speed factor along a flight (up: slower, players also with load / fatigue). */
function stairSpeedMul(w: SimWorld, b: PhysicsBody, up: boolean): number {
  const c = w.physics.cfg.stairs;
  if (b.kind === 'zombie') return up ? c.zombieUpMul : c.zombieDownMul;
  if (!up) return c.downMul;
  return (
    c.upMul *
    (c.loadUpMul[loadLevel(b.carriedKg, b.capacityKg)] ?? 1) *
    (c.enduranceUpMul[enduranceLevel(b.endurance)] ?? 1)
  );
}

/**
 * Moves `b` (entity `eid`, at x, y) by (dx, dy) on flight `s`: along the flight (× speed factor
 * when `scaled`), across clamped to the width, never closer than `stairs.spacing` to another
 * body on the flight in the direction of travel. Leaving past either end puts it on that level.
 */
function stairMove(
  w: SimWorld,
  eid: number,
  b: PhysicsBody,
  s: Stair,
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
  scaled: boolean,
  out: { x: number; y: number },
): void {
  const L = stairLocal(s, x, y);
  let da = s.dx !== 0 ? dx * s.dx : dy * s.dy;
  const dc = s.dx !== 0 ? dy : dx;
  if (scaled && da !== 0) da *= stairSpeedMul(w, b, da > 0);
  let along = L.along + da;
  const lo = Math.min(r, 0.5);
  const across = Math.min(1 - lo, Math.max(lo, L.across + dc));
  const gap = w.physics.cfg.stairs.spacing;
  const moved = movedThisTick(w);
  for (const o of sortedBodies(w.physics)) {
    if (o === b || o.stair !== b.stair || o.state === 'dead') continue;
    const oa = moved.get(o.id) ?? stairLocal(s, o.x, o.y).along;
    if (da > 0 && oa >= L.along) along = Math.min(along, Math.max(L.along, oa - gap));
    else if (da < 0 && oa <= L.along) along = Math.max(along, Math.min(L.along, oa + gap));
  }
  let z: number;
  if (along <= -r) {
    b.stair = 0;
    z = s.z;
  } else if (along >= s.len + r) {
    b.stair = 0;
    z = s.z + 1;
  } else z = stairZ(s, along);
  if (b.stair > 0) moved.set(b.id, along);
  else moved.delete(b.id);
  const p = stairWorld(s, along, across);
  out.x = Math.fround(p.x);
  out.y = Math.fround(p.y);
  w.c.Position.z[eid] = Math.fround(z);
}

/** Another body on flight `s` closer than `stairs.spacing` to its bottom entrance. */
function entranceBlocked(w: SimWorld, b: PhysicsBody, s: Stair, r: number): boolean {
  const gap = w.physics.cfg.stairs.spacing;
  for (const o of sortedBodies(w.physics)) {
    if (o === b || o.stair !== s.id + 1 || o.state === 'dead') continue;
    if (stairLocal(s, o.x, o.y).along < gap - r) return true;
  }
  return false;
}

/** Flights on level `z` touching the circle (x, y, r) (≤ 4 tile lookups). */
function stairsNear(grid: TileGrid, x: number, y: number, z: number, r: number): Stair[] {
  const found: Stair[] = [];
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      const s = grid.stairAt(tx, ty, z);
      if (s && !found.includes(s)) found.push(s);
    }
  }
  return found;
}

/** A flight from level z − 1 whose top the body at (x, y) on level z walks down into. */
function topEntry(
  grid: TileGrid,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  r: number,
): Stair | undefined {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  for (const [ox, oy] of [
    [0, 0],
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    const s = grid.stairAt(tx + ox, ty + oy, z - 1);
    if (!s) continue;
    const L = stairLocal(s, x, y);
    const da = s.dx !== 0 ? dx * s.dx : dy * s.dy;
    if (da >= 0 || L.across < 0 || L.across > 1) continue;
    if (L.along >= s.len - 1e-3 && L.along <= s.len + r + 0.05) return s;
  }
  return undefined;
}

/**
 * Movement hook (`MovementModifier.move`): stairs and level edges. Maps without stairs keep the
 * plain sweep (returns false).
 */
export function physicsLevelMove(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  dx: number,
  dy: number,
  out: { x: number; y: number },
): boolean {
  if (w.physics.stairs.length === 0) return false;
  const b = body(w, eid);
  if (!b) return false;
  const { Position, Collider } = w.c;
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const r = Collider.radius[eid] ?? 0;
  const cur = stairOf(w, b);
  if (cur) {
    stairMove(w, eid, b, cur, x, y, dx, dy, r, true, out);
    return true;
  }
  const z = floorZ(w, eid);
  const top = topEntry(grid, x, y, z, dx, dy, r);
  if (top) {
    b.stair = top.id + 1;
    stairMove(w, eid, b, top, x, y, dx, dy, r, true, out);
    return true;
  }
  // Players slide along walls (substeps, rounded corners), others use the per-axis sweep.
  if (b.kind === 'player') slideCircle(grid, z, x, y, dx, dy, r, out);
  else moveCircle(grid, z, x, y, dx, dy, r, out);
  flightZones(w, grid, eid, b, x, y, dx, dy, r, z, true, out);
  return true;
}

/**
 * A body off the flights moved from (x, y) to `out` on level z: entering a flight's corridor
 * only through its entrance (then it is on the flight, moved along it), never from the side or
 * under the top (blocked; the x part of the sweep is kept when it is clear). Shared by walking
 * and knock-back: a zombie's hit or shove at the bottom of the stairs used to push the player
 * into the corridor with `stair` 0, where it then walked along under the flight on the ground
 * floor and could never get onto it (osm-okulickiego, `?zspawn=2`).
 */
function flightZones(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  b: PhysicsBody,
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
  z: number,
  scaled: boolean,
  out: { x: number; y: number },
): void {
  for (const s of stairsNear(grid, out.x, out.y, z, r)) {
    const now = stairLocal(s, x, y);
    const next = stairLocal(s, out.x, out.y);
    if (!inZone(s, next.along, next.across, r) || inZone(s, now.along, now.across, r)) continue;
    if (now.along <= -r && next.across >= 0 && next.across <= 1) {
      // Through the entrance: onto the flight, unless a body is still within `spacing` of the
      // bottom (two bodies side by side at the entrance would otherwise both get on).
      if (entranceBlocked(w, b, s, r)) {
        out.x = Math.fround(x);
        out.y = Math.fround(y);
        return;
      }
      b.stair = s.id + 1;
      stairMove(w, eid, b, s, x, y, dx, dy, r, scaled, out);
      return;
    }
    // From the side (or under the top): blocked; keep the x part of the sweep if it is clear.
    const xOnly = stairLocal(s, out.x, y);
    if (inZone(s, xOnly.along, xOnly.across, r)) out.x = Math.fround(x);
    out.y = Math.fround(y);
  }
}

/** Highest level below `z` with a floor at (tx, ty) (within `fall.maxLevels`). */
export function landingLevel(
  w: SimWorld,
  grid: TileGrid,
  tx: number,
  ty: number,
  z: number,
): number | undefined {
  for (let k = 1; k <= w.physics.cfg.fall.maxLevels; k++) {
    if (hasFloor(grid, tx, ty, z - k)) return z - k;
  }
  return undefined;
}

/**
 * Knock-back collision of a body: on a flight in its corridor (no speed factor), elsewhere a
 * sweep where missing floor does not stop it when there is a floor to land on below (it then
 * falls, `startFalls`).
 */
export function knockbackMove(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  b: PhysicsBody,
  dx: number,
  dy: number,
  out: { x: number; y: number },
): void {
  const r = w.c.Collider.radius[eid] ?? 0;
  const s = stairOf(w, b);
  if (s) {
    stairMove(w, eid, b, s, b.x, b.y, dx, dy, r, false, out);
    return;
  }
  const z = floorZ(w, eid);
  moveCircle(grid, z, b.x, b.y, dx, dy, r, out, false);
  const tx = Math.floor(out.x);
  const ty = Math.floor(out.y);
  if (grid.isVoid(tx, ty, z) && landingLevel(w, grid, tx, ty, z) === undefined)
    moveCircle(grid, z, b.x, b.y, dx, dy, r, out);
  // Flights: into a corridor only through the entrance (as when walking).
  if (w.physics.stairs.length > 0) flightZones(w, grid, eid, b, b.x, b.y, dx, dy, r, z, false, out);
}

/** Fall time in ticks for a drop of `levels`: √(2h / g). */
export function fallTicks(w: SimWorld, levels: number): number {
  const f = w.physics.cfg.fall;
  const h = levels * f.floorHeightM;
  return Math.max(1, Math.round(Math.sqrt((2 * h) / f.gravity) * 20));
}

/** Bodies whose centre is over a tile without floor (knocked over an edge) start to fall. */
export function startFalls(
  w: SimWorld,
  grid: TileGrid,
  eidOf: ReadonlyMap<number, number>,
  events: PhysicsEvent[],
): void {
  const { Position, Velocity } = w.c;
  for (const [sid, eid] of eidOf) {
    const b = w.physics.bodies.get(sid)!;
    if (b.stair || b.state === 'fall' || b.state === 'dead') continue;
    const z = floorZ(w, eid);
    const tx = Math.floor(Position.x[eid] ?? 0);
    const ty = Math.floor(Position.y[eid] ?? 0);
    if (!grid.isVoid(tx, ty, z)) continue;
    const to = landingLevel(w, grid, tx, ty, z);
    if (to === undefined) continue;
    b.vel = { x: 0, y: 0 };
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    b.fallFromZ = z;
    b.fallToZ = to;
    setState(b, 'fall', w.tick, fallTicks(w, z - to));
    events.push({ type: 'startedFalling', entityId: b.id, tick: w.tick });
  }
}

/**
 * Falling bodies: z follows free fall (∝ t²) down to the landing level; on landing the damage
 * roll (3 `rng.physics` draws), `landed` + `fellFromHeight`, then a knock-down (or death).
 */
export function fallSystem(
  w: SimWorld,
  eidOf: ReadonlyMap<number, number>,
  events: PhysicsEvent[],
): void {
  const pw = w.physics;
  for (const [sid, eid] of eidOf) {
    const b = pw.bodies.get(sid)!;
    if (b.state !== 'fall') continue;
    const t = w.tick - b.stateStartTick;
    if (t < b.stateDuration) {
      const k = t / b.stateDuration;
      w.c.Position.z[eid] = Math.fround(b.fallFromZ - (b.fallFromZ - b.fallToZ) * k * k);
      continue;
    }
    land(w, eid, b, events);
  }
}

function land(w: SimWorld, eid: number, b: PhysicsBody, events: PhysicsEvent[]): void {
  const pw = w.physics;
  const f = pw.cfg.fall;
  const levels = b.fallFromZ - b.fallToZ;
  w.c.Position.z[eid] = b.fallToZ;
  const u1 = pw.rng.nextFloat();
  const u2 = pw.rng.nextFloat();
  const u3 = pw.rng.nextFloat();
  const lethal = levels >= f.deathLevels;
  const row = f.damage[Math.min(levels, f.damage.length) - 1]!;
  const dmg = lethal ? 1000 : u1 < row.chance ? Math.fround(row.min + u2 * (row.max - row.min)) : 0;
  let killed = false;
  const s = w.survival;
  if (b.kind === 'player') {
    if (s && dmg > 0 && !s.dead[eid]) {
      const hp = clampStat((s.vitals.health[eid] ?? 0) - dmg);
      s.vitals.health[eid] = hp;
      if (hp <= 0) {
        s.cause[eid] = deathCauseIndex('fall');
        killed = true;
      }
      // Legs take it: thigh / shin / foot (BODY_PARTS 11..16).
      const part = 11 + Math.min(5, Math.floor(u3 * 6));
      inflictWound(w, eid, part, woundKindIndex(levels >= 2 ? 'deep' : 'scratch'));
    }
  } else if (dmg > 0) {
    const hp = Math.fround((w.c.Zombie.hp[eid] ?? 0) - dmg);
    w.c.Zombie.hp[eid] = hp > 0 ? hp : 0;
    if (hp <= 0) {
      killed = true;
      killZombieByWorld(w, eid);
    }
  }
  events.push({ type: 'landed', entityId: b.id, tick: w.tick });
  const ev: Extract<SimEvent, { type: 'fellFromHeight' }> = {
    type: 'fellFromHeight',
    tick: w.tick,
    entity: b.id,
    levels,
    damage: Math.round(dmg * 10) / 10,
    killed,
  };
  w.events.push(ev);
  b.fallFromZ = 0;
  b.fallToZ = 0;
  if (killed) {
    kill(b, w.tick, events);
    return;
  }
  setState(
    b,
    'knockdown',
    w.tick,
    b.kind === 'zombie' ? f.knockdownTicks.zombie : f.knockdownTicks.player,
  );
  events.push({ type: 'fellDown', entityId: b.id, tick: w.tick });
}

/**
 * Domino down a flight: `target` (on a flight) was just staggered / floored by a push pointing
 * down the flight; the bodies below it (nearest first) fall with `dominoChance`, × `dominoDecay`
 * for each next one; the chain stops at the first that stays up.
 */
export function stairDomino(w: SimWorld, target: PhysicsBody, events: PhysicsEvent[]): void {
  const s = stairOf(w, target);
  if (!s || (target.state !== 'stagger' && target.state !== 'knockdown')) return;
  const kb = target.knockback;
  if (kb.dirX * -s.dx + kb.dirY * -s.dy <= 0.3) return;
  const pw = w.physics;
  const c = pw.cfg.stairs;
  const at = stairLocal(s, target.x, target.y).along;
  const below = sortedBodies(pw)
    .filter(
      (o) =>
        o !== target &&
        o.stair === target.stair &&
        canAct(o.state) &&
        stairLocal(s, o.x, o.y).along < at,
    )
    .map((o) => ({ o, a: stairLocal(s, o.x, o.y).along }))
    .sort((p, q) => q.a - p.a || p.o.id - q.o.id);
  let p = c.dominoChance;
  for (const { o } of below) {
    if (pw.rng.nextFloat() >= p) break;
    const d = pw.cfg.durations;
    setState(
      o,
      'knockdown',
      w.tick,
      o.kind === 'zombie' ? d.knockdownZombie.max : d.knockdownPlayer.max,
    );
    o.knockback = { dirX: -s.dx, dirY: -s.dy, strength: kb.strength * p };
    o.lastHitTick = w.tick;
    o.vel = { x: 0, y: 0 };
    events.push({ type: 'fellDown', entityId: o.id, tick: w.tick });
    p *= c.dominoDecay;
  }
}

/**
 * Zombies pushing up a flight on a player standing on it (every `crowd.pulseTicks`): units of
 * the zombies below chasing that player (front one × 1, the rest × `crowd.backRankWeight`) against the
 * player's hold; the excess becomes a push from the front zombie (`hit`).
 */
export function stairPushSystem(
  w: SimWorld,
  eidOf: ReadonlyMap<number, number>,
  push: (zombie: number, player: number, force: number) => void,
): void {
  const pw = w.physics;
  if (pw.stairs.length === 0 || w.tick % pw.cfg.crowd.pulseTicks !== 0) return;
  const c = pw.cfg.stairs;
  const cc = pw.cfg.crowd;
  const { Zombie } = w.c;
  for (const p of sortedBodies(pw)) {
    if (p.kind !== 'player' || !p.stair || !canAct(p.state)) continue;
    const s = pw.stairs[p.stair - 1]!;
    const pe = eidOf.get(p.id);
    if (pe === undefined) continue;
    const at = stairLocal(s, p.x, p.y).along;
    const below: { o: PhysicsBody; a: number; eid: number }[] = [];
    for (const o of sortedBodies(pw)) {
      if (o.kind !== 'zombie' || o.stair !== p.stair || !canMove(o.state)) continue;
      const eid = eidOf.get(o.id);
      // Chasing this player (the front one stands still in reach, the rest walk up).
      if (eid === undefined || Zombie.state[eid] !== ZombieState.chase) continue;
      if (Zombie.targetId[eid] !== p.id) continue;
      const a = stairLocal(s, o.x, o.y).along;
      if (a < at) below.push({ o, a, eid });
    }
    if (below.length === 0) continue;
    below.sort((m, n) => n.a - m.a || m.o.id - n.o.id);
    let units = 0;
    below.forEach(({ o }, i) => {
      units += (o.bodyMassKg / pw.cfg.refMassKg) * (i === 0 ? 1 : cc.backRankWeight);
    });
    const excess = units - (c.holdForce * p.bodyMassKg) / pw.cfg.refMassKg - cc.freeUnits;
    if (excess > 0) push(below[0]!.eid, pe, Math.min(1, excess * c.pushForcePerUnit));
  }
}
