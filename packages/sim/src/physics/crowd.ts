import type { SimEvent } from '@deadzone/protocol';
import { ZombieState } from '../ai/state.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { damageOpening, edgeCentre } from '../openings/actions.js';
import { baseState, maxHp, OpeningKind, openingView, OS, unpackKey } from '../openings/state.js';
import type { TileGrid } from '../world/grid.js';
import { canAct, canMove } from './modifiers.js';
import { PHYS_TICKS_PER_SECOND } from './constants.js';
import type { PhysicsBody } from './types.js';
import { floorZ } from '../world/levels.js';
import { holdersOf, holdPulse, holdUnits } from './hold-door.js';
import { crowdPushFurniture, furnitureDoorResist, movedPieceOn } from './furniture.js';

/**
 * Crowd pressure (PZ hordes): zombies pressing on a closed door / window / fence add up their
 * mass; a player holding it from the other side and planks push back. A lone zombie only bangs
 * on it (its blows in `ai.locomotion` stay as they were); the excess of a crowd damages the
 * edge every pulse through the same `damageOpening` as the blows (planks first, outermost one
 * by one, then the edge), breaks a window at once, knocks a low fence over and topples a gate
 * (`gateFallUnits`, barred = locked × `gateBarMul`). Zombies in a crowd also
 * push each other apart by mass (`separateZombies`). Deterministic: zombies in StableId order,
 * edges in key order, damage jitter from `rng.physics` (1 draw per damaging pulse).
 */

const body = (w: SimWorld, eid: number): PhysicsBody | undefined =>
  w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);

/** `ai.locomotion` hook: zombie `eid` presses on the closed edge `key` this tick. */
export function physicsPress(w: SimWorld, eid: number, key: number): void {
  const p = w.physics.presses;
  const a = p.get(key);
  if (a) a.push(eid);
  else p.set(key, [eid]);
}

/** Multiplier of a lone zombie's blow on an edge kind (fences: they mostly just bang on it). */
export function physicsBashMul(w: SimWorld, kind: number): number {
  const cc = w.physics.cfg.crowd;
  return kind === OpeningKind.fence
    ? cc.fenceBashMul
    : kind === OpeningKind.partition
      ? cc.partitionBashMul
      : 1;
}

const planksOf = (w: SimWorld, key: number): number => w.openings.states.get(key)?.planks ?? 0;

/** Pressure of the zombies on side `sign` of edge `key`, in zombie units, and their count. */
export interface EdgePressure {
  units: number;
  pushers: number;
  resist: number;
  /** Part of `resist` from moved furniture right behind the edge (`furniture.ts`). */
  furniture: number;
}

const purposeful = (s: number): boolean =>
  s === ZombieState.chase || s === ZombieState.investigate || s === ZombieState.search;

/**
 * Pressure on edge `key` from side `sign` (+1: the zombies are at x > tx / y > ty): zombies
 * within `reachTiles` of the edge centre on that side that walk towards it, weighted by mass and
 * rank; resistance of players holding it from the other side and of planks.
 */
export function edgePressure(w: SimWorld, key: number, sign: number, state: number): EdgePressure {
  const cc = w.physics.cfg.crowd;
  const ref = w.physics.cfg.refMassKg;
  const { Position, MoveIntent, Zombie } = w.c;
  const side = key % 2;
  const k = unpackKey(key);
  const c = edgeCentre(side, k.tx, k.ty);
  const edge = side === 0 ? k.ty : k.tx;
  const out: EdgePressure = { units: 0, pushers: 0, resist: 0, furniture: 0 };
  const reach2 = cc.reachTiles * cc.reachTiles;
  w.ai?.spatial.query(c.x, c.y, cc.reachTiles, (o) => {
    if (floorZ(w, o) !== k.z || (Zombie.hp[o] ?? 0) <= 0) return;
    if (!purposeful(Zombie.state[o] ?? 0)) return;
    const b = body(w, o);
    if (b && !canMove(b.state)) return;
    const x = Position.x[o] ?? 0;
    const y = Position.y[o] ?? 0;
    if (sign * ((side === 0 ? y : x) - edge) <= 0) return;
    const dx = c.x - x;
    const dy = c.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > reach2) return;
    if (dx * (MoveIntent.dx[o] ?? 0) + dy * (MoveIntent.dy[o] ?? 0) <= 0) return;
    const d = Math.sqrt(d2);
    const rank =
      d <= cc.frontTiles
        ? 1
        : 1 - ((1 - cc.backRankWeight) * (d - cc.frontTiles)) / (cc.reachTiles - cc.frontTiles);
    out.units += ((b?.bodyMassKg ?? w.physics.cfg.bodyMassKg.zombie) / ref) * rank;
    out.pushers++;
  });
  const s = w.survival;
  const hold2 = cc.holdReachTiles * cc.holdReachTiles;
  const active = cc.holdEnabled ? holdersOf(w, key) : [];
  for (const eid of [...w.players.values()].sort((a, b) => a - b)) {
    if (floorZ(w, eid) !== k.z || s?.dead[eid] || s?.asleep[eid]) continue;
    const holding = active.includes(eid);
    const b = body(w, eid);
    if (b && !canAct(b.state)) continue;
    const x = Position.x[eid] ?? 0;
    const y = Position.y[eid] ?? 0;
    if (sign * ((side === 0 ? y : x) - edge) >= 0) continue;
    const dx = c.x - x;
    const dy = c.y - y;
    // Actively holding (`holdDoor`): their push strength instead of the passive lean.
    if (holding) {
      out.resist += holdUnits(w, eid);
      continue;
    }
    if (dx * dx + dy * dy > hold2) continue;
    out.resist += (cc.holdForce * (b?.bodyMassKg ?? w.physics.cfg.bodyMassKg.player)) / ref;
  }
  // Planks: `barricadeResist` for a full barricade, proportionally less for fewer planks.
  const planks = state === OS.barricaded ? w.openings.cfg.barricade.maxPlanks : planksOf(w, key);
  out.resist += (cc.barricadeResist * planks) / w.openings.cfg.barricade.maxPlanks;
  // Moved furniture on the tile behind the edge (away from the crowd) holds it shut.
  out.furniture = furnitureDoorResist(w, behindPiece(w, key, sign));
  out.resist += out.furniture;
  return out;
}

/** Moved furniture on the tile behind edge `key` as seen from the crowd on side `sign`. */
function behindPiece(w: SimWorld, key: number, sign: number) {
  if (w.physics.furnitureMoves.size === 0) return undefined;
  const k = unpackKey(key);
  // N edge of (tx, ty) lies between rows ty − 1 and ty; W edge between columns tx − 1 and tx.
  const near = sign > 0 ? -1 : 0;
  return key % 2 === 0
    ? movedPieceOn(w, k.tx, k.ty + near, k.z)
    : movedPieceOn(w, k.tx + near, k.ty, k.z);
}

const levelOf = (excess: number, lv: readonly [number, number]): number =>
  excess <= 0 ? 0 : excess < lv[0] ? 1 : excess < lv[1] ? 2 : 3;

function emitPressure(
  w: SimWorld,
  key: number,
  kind: number,
  level: number,
  p: EdgePressure | undefined,
): void {
  const v = openingView(w.openings, key, kind);
  const ev: Extract<SimEvent, { type: 'openingPressure' }> = {
    type: 'openingPressure',
    tick: w.tick,
    tx: v.tx,
    ty: v.ty,
    z: v.z,
    side: v.side,
    kind: v.kind,
    level,
    units: p ? Math.round((p.units - p.resist) * 10) / 10 : 0,
    pushers: p?.pushers ?? 0,
  };
  w.events.push(ev);
}

/** One pressure pulse on edge `key` (pressed by `eids`); returns the new level. */
function pulse(w: SimWorld, grid: TileGrid, key: number, eids: readonly number[]): number {
  const cc = w.physics.cfg.crowd;
  const k = unpackKey(key);
  const side = key % 2;
  const kind = grid.kindOf(side === 0 ? grid.edgeN(k.tx, k.ty, k.z) : grid.edgeW(k.tx, k.ty, k.z));
  const e = w.openings.states.get(key);
  const state = e?.state ?? baseState(w.openings, key);
  const prev = w.physics.pressure.get(key) ?? 0;
  const passable = (state === OS.open || state === OS.broken) && !e?.planks;
  if (kind === OpeningKind.wall || passable || !eids.length) {
    if (prev) emitPressure(w, key, kind, 0, undefined);
    return 0;
  }
  const first = eids[0]!;
  const pos =
    side === 0 ? (w.c.Position.y[first] ?? 0) - k.ty : (w.c.Position.x[first] ?? 0) - k.tx;
  const p = edgePressure(w, key, pos >= 0 ? 1 : -1, state);
  const net = p.units - p.resist;
  if (cc.holdEnabled) holdPulse(w, key, pos >= 0 ? 1 : -1, p.units, net);
  // Enough pressure shoves the furniture behind the door one tile into the room (it then no
  // longer holds the door; the push uses the same placement checks as a player's).
  if (p.furniture > 0 && net >= w.physics.cfg.furniture.pushBackUnits) {
    const piece = behindPiece(w, key, pos >= 0 ? 1 : -1);
    const d = pos >= 0 ? -1 : 1;
    if (piece) crowdPushFurniture(w, piece, side === 1 ? d : 0, side === 0 ? d : 0);
  }
  const excess = net - cc.freeUnits;
  const level = levelOf(excess, cc.levelUnits);
  if (level !== prev) emitPressure(w, key, kind, level, p);
  if (excess <= 0) return level;
  const u = w.physics.rng.nextFloat();
  // A gate without planks falls over under heavy pressure (like a low fence, but at once); a
  // locked (barred) one only from `gateBarMul` × that. Same damage path as blows (all its hp).
  if (
    kind === OpeningKind.gate &&
    !e?.planks &&
    (state === OS.closed || state === OS.locked) &&
    net >= cc.gateFallUnits * (state === OS.locked ? cc.gateBarMul : 1)
  ) {
    damageOpening(w, key, kind, e?.hp ?? maxHp(w.openings.cfg, kind, state), 'crowd');
    return level;
  }
  if (
    kind === OpeningKind.window &&
    state === OS.closed &&
    !e?.planks &&
    net >= cc.windowBreakUnits
  ) {
    damageOpening(w, key, kind, e?.hp ?? maxHp(w.openings.cfg, kind, state), 'crowd');
    return level;
  }
  // Thin partitions give way only to a real crowd.
  if (kind === OpeningKind.partition && net < cc.partitionMinUnits) return level;
  // One excess unit = `bashesPerUnit` × the blows per second of the first presser's type.
  const def = w.ai?.types[w.c.Zombie.type[first] ?? 0]?.def;
  const bashDps = def
    ? ((def.damage.min + def.damage.max) / 2 / Math.max(0.05, def.attackCooldownSec)) *
      w.openings.cfg.zombieBashMul
    : 0;
  const dmg =
    ((excess * cc.bashesPerUnit * bashDps * cc.pulseTicks) / PHYS_TICKS_PER_SECOND) *
    (kind === OpeningKind.fence
      ? cc.fenceDamageMul
      : kind === OpeningKind.partition
        ? cc.partitionDamageMul
        : 1) *
    (1 + cc.damageJitter * (2 * u - 1));
  damageOpening(w, key, kind, Math.fround(dmg), 'crowd');
  return level;
}

/** Crowd pressure pulses (every `crowd.pulseTicks`); clears this tick's presses. */
export function crowdPressureSystem(w: SimWorld, grid: TileGrid): void {
  const pw = w.physics;
  const cc = pw.cfg.crowd;
  if (cc.enabled && w.tick % cc.pulseTicks === 0 && (pw.presses.size || pw.pressure.size)) {
    const keys = [...new Set([...pw.presses.keys(), ...pw.pressure.keys()])].sort((a, b) => a - b);
    for (const key of keys) {
      // Only zombies in the active chunks press (frozen ones keep their intent, no force).
      const eids = (pw.presses.get(key) ?? []).filter((e) => (body(w, e)?.frozenAt ?? -1) < 0);
      const level = pulse(w, grid, key, eids);
      if (level) pw.pressure.set(key, level);
      else pw.pressure.delete(key);
    }
  }
  pw.presses.clear();
}

let dxs = new Float64Array(0);
let dys = new Float64Array(0);
let mass = new Float64Array(0);
const order: number[] = [];

/**
 * Zombies in a crowd push each other: overlapping pairs (centres closer than the radii sum) are
 * moved apart by `stiffness` × (overlap − `slop`), the lighter one more (share = other mass / both masses), at most `maxStep` per tick. The push is stored on the body and swept with the
 * next movement step (`physicsMovementModifier.push`, so never through walls). The dead
 * zone and the partial correction keep a packed crowd calm (no jitter). Pairs come from a
 * sweep along x (zombies sorted by x, then StableId), so the result is deterministic.
 */
export function separateZombies(w: SimWorld): void {
  const ai = w.ai;
  const sc = w.physics.cfg.crowd.separation;
  if (!ai || ai.zombieCount === 0 || sc.stiffness <= 0) return;
  const { Position, Zombie, Collider } = w.c;
  const zs = sortedQuery(w, 'zombies', [Zombie]);
  let max = 0;
  for (const eid of zs) if (eid > max) max = eid;
  if (dxs.length <= max) {
    dxs = new Float64Array(max + 64);
    dys = new Float64Array(max + 64);
    mass = new Float64Array(max + 64);
  }
  // Active = alive and in control (lying / staggered zombies are walked around, not pushed).
  order.length = 0;
  let rMax = 0;
  for (const eid of zs) {
    dxs[eid] = 0;
    dys[eid] = 0;
    if ((Zombie.hp[eid] ?? 0) <= 0) continue;
    const b = body(w, eid);
    // Frozen bodies (outside the active chunks) are not pushed and do not push.
    if (!b || !canMove(b.state) || b.frozenAt >= 0) continue;
    mass[eid] = b.bodyMassKg;
    rMax = Math.max(rMax, Collider.radius[eid] ?? 0);
    order.push(eid);
  }
  // `zs` is in StableId order and the sort is stable: ties keep StableId order.
  order.sort((a, b) => (Position.x[a] ?? 0) - (Position.x[b] ?? 0));
  const span = rMax * 2;
  for (let i = 0; i < order.length; i++) {
    const a = order[i]!;
    const ax = Position.x[a] ?? 0;
    const ay = Position.y[a] ?? 0;
    const az = floorZ(w, a);
    const ra = Collider.radius[a] ?? 0;
    for (let j = i + 1; j < order.length; j++) {
      const o = order[j]!;
      const ox = (Position.x[o] ?? 0) - ax;
      if (ox >= span) break;
      const oy = (Position.y[o] ?? 0) - ay;
      const reach = ra + (Collider.radius[o] ?? 0);
      const d2 = ox * ox + oy * oy;
      if (d2 >= reach * reach || floorZ(w, o) !== az) continue;
      const d = Math.sqrt(d2);
      // Exactly on top of each other: split along x (sweep order).
      const nx = d > 1e-6 ? ox / d : 1;
      const ny = d > 1e-6 ? oy / d : 0;
      const corr = (reach - d - sc.slop) * sc.stiffness;
      if (corr <= 0) continue;
      const shareA = mass[o]! / (mass[a]! + mass[o]!);
      dxs[a]! -= nx * corr * shareA;
      dys[a]! -= ny * corr * shareA;
      dxs[o]! += nx * corr * (1 - shareA);
      dys[o]! += ny * corr * (1 - shareA);
    }
  }
  for (const eid of zs) {
    const b = body(w, eid);
    if (!b || b.frozenAt >= 0) continue;
    let dx = dxs[eid]!;
    let dy = dys[eid]!;
    const l2 = dx * dx + dy * dy;
    if (l2 > sc.maxStep * sc.maxStep) {
      const k = sc.maxStep / Math.sqrt(l2);
      dx *= k;
      dy *= k;
    }
    b.pushX = Math.fround(dx);
    b.pushY = Math.fround(dy);
  }
}
