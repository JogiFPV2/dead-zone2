import type { AnimalFleeReason } from '@deadzone/protocol';
import { floorOf } from '../ai/floors.js';
import { emitNoise, heard } from '../ai/noise.js';
import { noiseSourceIndex, type AiWorld, type CompiledAnimalType } from '../ai/state.js';
import { playerVisibility } from '../ai/light.js';
import { secToTicks } from '../ai/zombies.js';
import { detach, sortedQuery, type SimWorld } from '../core/world.js';
import type { TileGrid } from '../world/grid.js';
import { lineOfSight, walkableLine } from '../world/los.js';
import { ANIMAL_CONFIG as CFG, AnimalState } from './state.js';

/**
 * Pipeline `animals` (after `ai.locomotion`, before the shared `movement`): perception, FSM and
 * steering of animals, modelled on the zombie brain (docs 2.5 `ai`, 9.19). Animals think every
 * `thinkEveryTicks` (spread by StableId), far from every player only every `farThinkEveryTicks`
 * and without looking for players. Senses: a player within `fleeDistanceTiles` × visibility
 * (daylight / lights / dark zones / sneaking, the same `playerVisibility` as zombie sight) and in
 * line of sight, or within `nearSenseTiles`; a living zombie within `fleeDistanceTiles` in sight
 * (`fearsZombies`); any noise of the last think interval heard over `hearingRangeTiles` (same
 * damping as zombies; animal calls excluded, so dogs do not set each other off). FSM: graze ↔
 * wander, flee (until `safeDistanceTiles` from the threat and `fleeMinSec` passed), birds
 * (`fliesAway`) leave the world after `despawnAfterFleeSec`. Movement and collisions are the
 * shared `movement` system (intent + speed only here). Randomness only from `rng.animals`.
 * TODO(animals): zombies ignore animals (no hunting / eating them yet).
 */

interface Seen {
  eid: number;
  x: number;
  y: number;
  z: number;
  vis: number;
}
const players: Seen[] = [];

/** Flee directions tried in order: straight away, then ±30°, ±60°, ±90°, ±120° (fixed table). */
const ROT: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.8660254, 0.5],
  [0.8660254, -0.5],
  [0.5, 0.8660254],
  [0.5, -0.8660254],
  [0, 1],
  [0, -1],
  [-0.5, 0.8660254],
  [-0.5, -0.8660254],
];

const LOOKS = [CFG.fleeLookTiles, 2] as const;

export function animalSystem(w: SimWorld, grid: TileGrid): void {
  const ai = w.ai;
  if (!ai || ai.animalCount === 0) return;
  const { Position, StableId, Animal } = w.c;
  players.length = 0;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if (w.survival?.dead[eid]) continue;
    players.push({
      eid,
      x: Position.x[eid] ?? 0,
      y: Position.y[eid] ?? 0,
      z: floorOf(Position.z[eid] ?? 0),
      vis: playerVisibility(w, ai, eid),
    });
  }
  const far2 = CFG.farTiles * CFG.farTiles;
  for (const eid of sortedQuery(w, 'animals', [Animal])) {
    const state = Animal.state[eid] ?? 0;
    if (state === AnimalState.dead || state === AnimalState.gone) continue;
    const t = ai.animalTypes[Animal.type[eid] ?? 0]!;
    const x = Position.x[eid] ?? 0;
    const y = Position.y[eid] ?? 0;
    const z = floorOf(Position.z[eid] ?? 0);
    let near = false;
    for (const p of players) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (p.z === z && dx * dx + dy * dy <= far2) near = true;
    }
    const every = near ? CFG.thinkEveryTicks : CFG.farThinkEveryTicks;
    if ((w.tick + (StableId.value[eid] ?? 0)) % every === 0) {
      think(w, ai, grid, eid, t, x, y, z, near, every);
    }
    if (timers(w, ai, grid, eid, t, x, y, z)) continue;
    steer(w, grid, eid, t, x, y, z);
  }
}

function think(
  w: SimWorld,
  ai: AiWorld,
  grid: TileGrid,
  eid: number,
  t: CompiledAnimalType,
  x: number,
  y: number,
  z: number,
  near: boolean,
  every: number,
): void {
  const def = t.def;
  const { Animal, Position, Zombie } = w.c;
  let reason: AnimalFleeReason | undefined;
  let fx = 0;
  let fy = 0;
  let best = Infinity;
  // Players: noticed within the flee distance scaled by how visible they are (sneaking, night).
  if (near) {
    const near2 = CFG.nearSenseTiles * CFG.nearSenseTiles;
    for (const p of players) {
      if (p.z !== z) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      const range = Math.min(def.sightRangeTiles, def.fleeDistanceTiles) * p.vis;
      if (d2 >= best || (d2 > range * range && d2 > near2)) continue;
      if (d2 > near2 && !lineOfSight(grid, z, x, y, p.x, p.y)) continue;
      reason = 'player';
      fx = p.x;
      fy = p.y;
      best = d2;
    }
  }
  // Zombies in sight within the flee distance (spatial hash rebuilt by `ai.brain` this tick).
  if (def.fearsZombies && ai.zombieCount > 0) {
    const r = Math.min(def.sightRangeTiles, def.fleeDistanceTiles);
    ai.spatial.query(x, y, r, (zid) => {
      if (Zombie.is[zid] !== 1 || (Zombie.hp[zid] ?? 0) <= 0) return;
      if (floorOf(Position.z[zid] ?? 0) !== z) return;
      const zx = Position.x[zid] ?? 0;
      const zy = Position.y[zid] ?? 0;
      const dx = zx - x;
      const dy = zy - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r || d2 >= best) return;
      if (!lineOfSight(grid, z, x, y, zx, zy)) return;
      reason = 'zombie';
      fx = zx;
      fy = zy;
      best = d2;
    });
  }
  // Noises of the last think interval (footsteps, shots, impacts…; not animal calls).
  if (!reason) {
    const own = noiseSourceIndex('animal');
    let vol = -1;
    for (const n of ai.noises) {
      if (n.tick < w.tick - every || n.source === own || n.volume <= vol) continue;
      if (!heard(ai, grid, n, x, y, z, def.hearingRangeTiles)) continue;
      reason = 'noise';
      fx = n.x;
      fy = n.y;
      vol = n.volume;
    }
  }
  if (reason) {
    if ((Animal.state[eid] ?? 0) !== AnimalState.flee) startFlee(w, grid, eid, t, reason, fx, fy);
    else if (!def.fliesAway) {
      // Still threatened: keep running from the newest threat at least `fleeMinSec` more.
      Animal.fromX[eid] = Math.fround(fx);
      Animal.fromY[eid] = Math.fround(fy);
      Animal.stateTick[eid] = Math.max(
        Animal.stateTick[eid] ?? 0,
        w.tick + secToTicks(def.fleeMinSec),
      );
    }
  }
  if ((Animal.state[eid] ?? 0) === AnimalState.flee) fleeGoal(w, grid, eid, x, y, z);
}

/**
 * Starts fleeing from (fx, fy) (`animalFled`); also used by combat (`reason: 'hit'`). Birds get
 * their despawn timer, a dog barks (`fleeNoise`, source `animal`: zombies hear it).
 */
export function startFlee(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  t: CompiledAnimalType,
  reason: AnimalFleeReason,
  fx: number,
  fy: number,
): void {
  const { Animal, Position, StableId } = w.c;
  const def = t.def;
  const wasFleeing = (Animal.state[eid] ?? 0) === AnimalState.flee;
  Animal.fromX[eid] = Math.fround(fx);
  Animal.fromY[eid] = Math.fround(fy);
  if (wasFleeing && def.fliesAway) return;
  Animal.state[eid] = AnimalState.flee;
  Animal.stateTick[eid] = Math.max(
    wasFleeing ? (Animal.stateTick[eid] ?? 0) : 0,
    w.tick + secToTicks(def.fliesAway ? def.despawnAfterFleeSec : def.fleeMinSec),
  );
  const x = Position.x[eid] ?? 0;
  const y = Position.y[eid] ?? 0;
  const z = Position.z[eid] ?? 0;
  fleeGoal(w, grid, eid, x, y, floorOf(z));
  if (wasFleeing) return;
  const call = def.fleeNoise;
  if (call) emitNoise(w, x, y, z, call.radiusTiles, call.volume, 'animal');
  w.events.push({
    type: 'animalFled',
    tick: w.tick,
    animal: StableId.value[eid] ?? 0,
    animalType: def.id,
    reason,
    x,
    y,
    fromX: Math.fround(fx),
    fromY: Math.fround(fy),
    noise: call !== undefined,
  });
}

/**
 * Flee goal `fleeLookTiles` ahead, directly away from `from`; the first direction of ROT with a
 * walkable straight line wins (then the same at 2 tiles), else straight away (collisions slide).
 */
function fleeGoal(w: SimWorld, g: TileGrid, eid: number, x: number, y: number, z: number): void {
  const { Animal } = w.c;
  let dx = x - (Animal.fromX[eid] ?? 0);
  let dy = y - (Animal.fromY[eid] ?? 0);
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-4) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  let gx = x + dx * CFG.fleeLookTiles;
  let gy = y + dy * CFG.fleeLookTiles;
  search: for (const look of LOOKS) {
    for (const [c, s] of ROT) {
      const rx = dx * c - dy * s;
      const ry = dx * s + dy * c;
      const px = x + rx * look;
      const py = y + ry * look;
      if (g.isVoid(Math.floor(px), Math.floor(py), z)) continue;
      if (!walkableLine(g, z, x, y, px, py)) continue;
      gx = px;
      gy = py;
      break search;
    }
  }
  Animal.tx[eid] = Math.fround(gx);
  Animal.ty[eid] = Math.fround(gy);
}

/** Per-tick state timers; returns true when the animal left the world this tick. */
function timers(
  w: SimWorld,
  ai: AiWorld,
  grid: TileGrid,
  eid: number,
  t: CompiledAnimalType,
  x: number,
  y: number,
  z: number,
): boolean {
  const { Animal } = w.c;
  const def = t.def;
  const rng = w.rng.animals;
  const graze = (): void => {
    Animal.state[eid] = AnimalState.graze;
    Animal.stateTick[eid] =
      w.tick + rng.int(secToTicks(def.grazeSec.min), secToTicks(def.grazeSec.max));
  };
  switch (Animal.state[eid]) {
    case AnimalState.graze: {
      if (w.tick < (Animal.stateTick[eid] ?? 0)) break;
      const r = Math.max(1, Math.round(def.wanderRadiusTiles));
      const hx = Math.floor(Animal.homeX[eid] ?? x);
      const hy = Math.floor(Animal.homeY[eid] ?? y);
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        const gx = hx + rng.int(-r, r) + 0.5;
        const gy = hy + rng.int(-r, r) + 0.5;
        if (grid.isVoid(Math.floor(gx), Math.floor(gy), z)) continue;
        if (!walkableLine(grid, z, x, y, gx, gy)) continue;
        const dx = gx - x;
        const dy = gy - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        Animal.tx[eid] = Math.fround(gx);
        Animal.ty[eid] = Math.fround(gy);
        Animal.state[eid] = AnimalState.wander;
        Animal.stateTick[eid] =
          w.tick +
          Math.ceil((dist / Math.max(t.wanderPerTick, 1e-3)) * CFG.legSlack) +
          CFG.legExtraTicks;
        ok = true;
      }
      if (!ok) graze();
      break;
    }
    case AnimalState.wander: {
      const dx = (Animal.tx[eid] ?? x) - x;
      const dy = (Animal.ty[eid] ?? y) - y;
      if (dx * dx + dy * dy <= CFG.arriveTiles * CFG.arriveTiles) graze();
      else if (w.tick >= (Animal.stateTick[eid] ?? 0)) graze();
      break;
    }
    case AnimalState.flee: {
      if (w.tick < (Animal.stateTick[eid] ?? 0)) break;
      if (def.fliesAway) {
        despawnAnimal(w, ai, eid);
        return true;
      }
      const dx = x - (Animal.fromX[eid] ?? x);
      const dy = y - (Animal.fromY[eid] ?? y);
      if (dx * dx + dy * dy >= def.safeDistanceTiles * def.safeDistanceTiles) {
        // Calmed down: this is the new home (wanders here from now on).
        Animal.homeX[eid] = Math.fround(x);
        Animal.homeY[eid] = Math.fround(y);
        graze();
      }
      break;
    }
  }
  return false;
}

function steer(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  t: CompiledAnimalType,
  x: number,
  y: number,
  z: number,
): void {
  const { Animal, MoveIntent, MoveStats } = w.c;
  const state = Animal.state[eid] ?? 0;
  let dx = 0;
  let dy = 0;
  if (state === AnimalState.wander || state === AnimalState.flee) {
    let gx = Animal.tx[eid] ?? x;
    let gy = Animal.ty[eid] ?? y;
    let ex = gx - x;
    let ey = gy - y;
    if (state === AnimalState.flee && ex * ex + ey * ey < 1) {
      // Reached the flee goal between thinks: look further away right now.
      fleeGoal(w, grid, eid, x, y, z);
      gx = Animal.tx[eid] ?? x;
      gy = Animal.ty[eid] ?? y;
      ex = gx - x;
      ey = gy - y;
    }
    const len = Math.sqrt(ex * ex + ey * ey);
    if (len > 1e-4) {
      dx = ex / len;
      dy = ey / len;
    }
  }
  MoveIntent.dx[eid] = Math.fround(dx);
  MoveIntent.dy[eid] = Math.fround(dy);
  MoveStats.speedPerTick[eid] = state === AnimalState.flee ? t.fleePerTick : t.wanderPerTick;
}

/** A bird flew off: leaves movement and the snapshot for good (`animalDespawned`). */
export function despawnAnimal(w: SimWorld, ai: AiWorld, eid: number): void {
  const c = w.c;
  c.Animal.state[eid] = AnimalState.gone;
  c.Velocity.x[eid] = 0;
  c.Velocity.y[eid] = 0;
  c.MoveIntent.dx[eid] = 0;
  c.MoveIntent.dy[eid] = 0;
  for (const comp of [
    c.Position,
    c.Velocity,
    c.Facing,
    c.Collider,
    c.MoveIntent,
    c.AimIntent,
    c.MoveStats,
  ]) {
    detach(w, eid, comp);
  }
  ai.animalCount--;
  w.events.push({
    type: 'animalDespawned',
    tick: w.tick,
    animal: c.StableId.value[eid] ?? 0,
    animalType: ai.animalTypes[c.Animal.type[eid] ?? 0]?.def.id ?? '',
    reason: 'fled',
  });
}
