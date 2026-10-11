import {
  TARGET_LAST_HIT_SEC,
  TARGET_MAX_TILES,
  TARGET_PICK_TILES,
  type CommandRejectReason,
  type TargetSource,
  type TargetState,
  type TargetView,
} from '@deadzone/protocol';
import { entityNamePl } from '@deadzone/content';
import { ZombieState } from '../ai/state.js';
import { AnimalState } from '../animals/state.js';
import { secToTicks } from '../ai/zombies.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { defOf, maxCondition } from '../items/store.js';
import { bodyOf } from '../physics/system.js';
import { skillLevel } from '../progress/skills.js';
import { Pen, penaltyMul } from '../survival/penalties.js';
import { vehicleTypes } from '../vehicles/seats.js';
import type { Vehicle } from '../vehicles/types.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';
import { lineOfSight } from '../world/los.js';
import { firearmOf } from './firearms.js';
import type { PlayerTargetState, TargetRef } from './state.js';
import { heldCondition, meleeOf } from './system.js';

/**
 * HUD target card (docs 9.40). UI only: reads the world, never changes the simulation; the lock
 * and last hit live in `CombatWorld.targets` (not hashed, not saved).
 */

const stateOf = (w: SimWorld, eid: number): PlayerTargetState => {
  const cb = w.ai!.combat;
  let t = cb.targets.get(eid);
  if (!t) cb.targets.set(eid, (t = { lock: undefined, hitId: 0, hitTick: 0 }));
  return t;
};

/** Entity with StableId `sid` among the rendered ones (players, zombies, corpses, animals). */
function eidOfSid(w: SimWorld, sid: number): number | undefined {
  for (const eid of sortedQuery(w, 'render', [w.c.Position, w.c.Facing])) {
    if (w.c.StableId.value[eid] === sid) return eid;
  }
  return undefined;
}

const isPlayer = (w: SimWorld, eid: number): boolean => {
  for (const p of w.players.values()) if (p === eid) return true;
  return false;
};

/** Dead body (zombie hp 0, dead / gone animal, dead player). */
function isDead(w: SimWorld, eid: number): boolean {
  const { Zombie, Animal } = w.c;
  if (Animal.is[eid] === 1) return (Animal.state[eid] ?? 0) >= AnimalState.dead;
  if (Zombie.is[eid] === 1) return (Zombie.hp[eid] ?? 0) <= 0;
  return w.survival?.dead[eid] === 1;
}

const isTargetable = (w: SimWorld, eid: number): boolean =>
  w.c.Zombie.is[eid] === 1 || w.c.Animal.is[eid] === 1 || isPlayer(w, eid);

interface Where {
  x: number;
  y: number;
  z: number;
}

function whereOf(w: SimWorld, ref: TargetRef): Where | undefined {
  if (ref.vehicle) {
    const v = w.physics.vehicles.get(ref.id);
    return v ? { x: v.x, y: v.y, z: v.z } : undefined;
  }
  const eid = eidOfSid(w, ref.id);
  if (eid === undefined) return undefined;
  return { x: w.c.Position.x[eid] ?? 0, y: w.c.Position.y[eid] ?? 0, z: floorZ(w, eid) };
}

/** Lock rules: same floor, ≤ TARGET_MAX_TILES, line of sight. */
function reachable(w: SimWorld, grid: TileGrid, eid: number, at: Where): boolean {
  const x = w.c.Position.x[eid] ?? 0;
  const y = w.c.Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  if (at.z !== z) return false;
  const dx = at.x - x;
  const dy = at.y - y;
  if (dx * dx + dy * dy > TARGET_MAX_TILES * TARGET_MAX_TILES) return false;
  return lineOfSight(grid, z, x, y, at.x, at.y);
}

/** `setTarget {id | null}` (input system). */
export function applySetTarget(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  id: number | null,
): CommandRejectReason | undefined {
  if (!w.ai) return 'invalid-state';
  const st = stateOf(w, eid);
  if (id === null) {
    st.lock = undefined;
    return undefined;
  }
  let ref: TargetRef | undefined;
  const t = eidOfSid(w, id);
  if (t !== undefined && t !== eid && isTargetable(w, t) && !isDead(w, t)) {
    ref = { vehicle: false, id };
  } else if (t === undefined && w.physics.vehicles.has(id)) {
    ref = { vehicle: true, id };
  }
  if (!ref) return 'invalid-target';
  const at = whereOf(w, ref);
  if (!at || !reachable(w, grid, eid, at)) return 'out-of-range';
  st.lock = ref;
  return undefined;
}

/** Is the aim point (ax, ay) over the car (its rectangle grown by TARGET_PICK_TILES)? */
function overVehicle(w: SimWorld, v: Vehicle, ax: number, ay: number): boolean {
  const t = vehicleTypes(w)[v.type];
  if (!t) return false;
  const dx = ax - v.x;
  const dy = ay - v.y;
  const along = dx * v.hx + dy * v.hy;
  const across = -dx * v.hy + dy * v.hx;
  return (
    Math.abs(along) <= t.length / 2 + TARGET_PICK_TILES &&
    Math.abs(across) <= t.width / 2 + TARGET_PICK_TILES
  );
}

/** What is under the aim point: the living creature nearest to it, else a car. */
function pickAtAim(w: SimWorld, grid: TileGrid, eid: number): TargetRef | undefined {
  const { AimIntent, Position, Collider, StableId } = w.c;
  if (!AimIntent.active[eid]) return undefined;
  const ax = AimIntent.x[eid] ?? 0;
  const ay = AimIntent.y[eid] ?? 0;
  const z = floorZ(w, eid);
  let best: number | undefined;
  let bestD2 = Infinity;
  for (const e of sortedQuery(w, 'render', [Position, w.c.Facing])) {
    if (e === eid || !isTargetable(w, e) || isDead(w, e) || floorZ(w, e) !== z) continue;
    const dx = (Position.x[e] ?? 0) - ax;
    const dy = (Position.y[e] ?? 0) - ay;
    const r = (Collider.radius[e] ?? 0) + TARGET_PICK_TILES;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r * r && d2 < bestD2) {
      best = e;
      bestD2 = d2;
    }
  }
  if (best !== undefined) {
    const ref = { vehicle: false, id: StableId.value[best] ?? 0 };
    const at = whereOf(w, ref);
    if (at && reachable(w, grid, eid, at)) return ref;
  }
  for (const v of [...w.physics.vehicles.values()].sort((a, b) => a.id - b.id)) {
    if (v.z !== z || !overVehicle(w, v, ax, ay)) continue;
    if (reachable(w, grid, eid, { x: v.x, y: v.y, z: v.z })) return { vehicle: true, id: v.id };
  }
  return undefined;
}

/** Current target of player `eid` (lock → aim → last hit), or null. */
export function targetView(w: SimWorld, grid: TileGrid, eid: number): TargetView | null {
  if (!w.ai || w.survival?.dead[eid]) return null;
  const st = w.ai.combat.targets.get(eid);
  let source: TargetSource = 'lock';
  let ref = st?.lock;
  if (ref) {
    const at = whereOf(w, ref);
    const t = ref.vehicle ? undefined : eidOfSid(w, ref.id);
    const alive = ref.vehicle || (t !== undefined && !isDead(w, t));
    if (!at || !alive || !reachable(w, grid, eid, at)) {
      st!.lock = undefined;
      ref = undefined;
    }
  }
  if (!ref) {
    source = 'aim';
    ref = pickAtAim(w, grid, eid);
  }
  if (!ref && st && st.hitId !== 0 && w.tick - st.hitTick <= secToTicks(TARGET_LAST_HIT_SEC)) {
    source = 'hit';
    ref = { vehicle: false, id: st.hitId };
  }
  if (!ref) return null;
  return describe(w, grid, eid, ref, source);
}

const pct = (v: number): number => Math.max(0, Math.min(100, Math.round(v * 100)));

function describe(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  ref: TargetRef,
  source: TargetSource,
): TargetView | null {
  const { Position, Zombie, Animal, StableId, Collider } = w.c;
  const ai = w.ai!;
  const px = Position.x[eid] ?? 0;
  const py = Position.y[eid] ?? 0;
  const dist = (x: number, y: number): number => Math.sqrt((x - px) ** 2 + (y - py) ** 2);
  if (ref.vehicle) {
    const v = w.physics.vehicles.get(ref.id);
    if (!v) return null;
    const typeId = vehicleTypes(w)[v.type]?.id ?? '';
    const zones = v.zones.length > 0 ? v.zones.reduce((a, b) => a + b, 0) / v.zones.length : 100;
    return {
      id: v.id,
      kind: 'vehicle',
      typeId,
      name: entityNamePl('vehicle', typeId),
      hpPct: Math.round(Math.max(0, Math.min(100, zones))),
      distanceM: Math.round(dist(v.x, v.y) * 10) / 10,
      ...weaponOf(w, eid),
      source,
    };
  }
  const t = eidOfSid(w, ref.id);
  if (t === undefined) return null;
  const tx = Position.x[t] ?? 0;
  const ty = Position.y[t] ?? 0;
  const d = dist(tx, ty);
  const dead = isDead(w, t);
  const phys = bodyOf(w, t)?.state;
  const down = phys === 'knockdown' || phys === 'getup' || phys === 'fall';
  let kind: TargetView['kind'];
  let typeId = '';
  let name: string;
  let hp: number;
  let state: TargetState | undefined;
  if (Zombie.is[t] === 1) {
    kind = 'zombie';
    const type = ai.types[Zombie.type[t] ?? 0]?.def;
    typeId = type?.id ?? '';
    name = entityNamePl('zombie', typeId);
    hp = type && type.health > 0 ? (Zombie.hp[t] ?? 0) / type.health : 0;
    const zs = Zombie.state[t] ?? 0;
    state = dead
      ? 'dead'
      : down
        ? 'downed'
        : zs === ZombieState.chase
          ? (ai.combat.zombieReady[t] ?? 0) > 0
            ? 'attacking'
            : 'chasing'
          : zs === ZombieState.wander
            ? 'wander'
            : 'idle';
  } else if (Animal.is[t] === 1) {
    kind = 'animal';
    const type = ai.animalTypes[Animal.type[t] ?? 0]?.def;
    typeId = type?.id ?? '';
    name = entityNamePl('animal', typeId);
    hp = type && type.health > 0 ? (Animal.hp[t] ?? 0) / type.health : 0;
    const as = Animal.state[t] ?? 0;
    state = dead
      ? 'dead'
      : as === AnimalState.flee
        ? 'fleeing'
        : as === AnimalState.wander
          ? 'wander'
          : 'idle';
  } else {
    kind = 'player';
    const ch = w.items?.characters.get(StableId.value[t] ?? 0);
    name = ch ? `${ch.firstName} ${ch.lastName}`.trim() : 'Ocalały';
    hp = (w.survival?.vitals.health[t] ?? 100) / 100;
    state = dead ? 'dead' : down ? 'downed' : undefined;
  }
  const view: TargetView = {
    id: ref.id,
    kind,
    typeId,
    name,
    hpPct: dead ? 0 : pct(hp),
    distanceM: Math.round(d * 10) / 10,
    ...(state ? { state } : {}),
    source,
  };
  if (!dead) view.hitChancePct = hitChance(w, grid, eid, t, d, Collider.radius[t] ?? 0);
  return { ...view, ...weaponOf(w, eid) };
}

/** Chance (%) that the next attack hits the target at distance `d` (docs 9.40). */
function hitChance(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  t: number,
  d: number,
  radius: number,
): number {
  const cb = w.ai!.combat;
  const z = floorZ(w, eid);
  if (floorZ(w, t) !== z) return 0;
  const { Position } = w.c;
  const sight = lineOfSight(
    grid,
    z,
    Position.x[eid] ?? 0,
    Position.y[eid] ?? 0,
    Position.x[t] ?? 0,
    Position.y[t] ?? 0,
  );
  if (!sight) return 0;
  const gun = firearmOf(w, eid);
  if (gun) {
    const r = gun.def.ranged;
    if (d > r.rangeTiles) return 0;
    const fc = cb.cfg.firearms;
    const aim =
      penaltyMul(w, eid, Pen.attack) * (1 + fc.accuracyPerSkillLevel * skillLevel(w, eid, r.skill));
    return pct(r.accuracy * (1 - (fc.hitFalloffAtRange * d) / r.rangeTiles) * aim);
  }
  return d <= meleeOf(w, cb, eid).rangeTiles + radius ? 100 : 0;
}

function weaponOf(w: SimWorld, eid: number): Pick<TargetView, 'weapon'> {
  const st = w.items;
  if (!st || !w.ai) return {};
  const gun = firearmOf(w, eid);
  const id = gun ? gun.item.id : meleeOf(w, w.ai.combat, eid).item;
  const item = id === undefined ? undefined : st.items.get(id);
  if (!item) return {};
  const def = defOf(st, item);
  // Improvised weapons count their wear against `meleeStatsFor(item).durability` (docs 9.41).
  const { condition, max } = gun
    ? { condition: item.condition, max: maxCondition(def) }
    : heldCondition(st, item);
  return {
    weapon: { id: def.id, conditionPct: max > 0 ? pct(condition / max) : 100 },
  };
}
