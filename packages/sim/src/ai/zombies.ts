import type { SimZombieSpawn } from '@deadzone/protocol';
import { attach, spawnEntity, type SimWorld } from '../core/world.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { circleOverlaps } from '../world/collision.js';
import type { TileGrid } from '../world/grid.js';
import { ZombieState, type AiWorld } from './state.js';
import { addPhysicsBody } from '../physics/system.js';

export const secToTicks = (sec: number): number => Math.max(1, Math.round(sec * TICKS_PER_SECOND));

/** Type index for a content id, or a weighted pick (`spawnWeight`, RNG `world`); −1 = none. */
export function pickZombieType(w: SimWorld, ai: AiWorld, typeId?: string): number {
  if (typeId !== undefined) return w.survival?.content.zombieTypeIndex.get(typeId) ?? -1;
  if (ai.types.length === 0) return -1;
  if (ai.types.length === 1) return 0;
  return w.rng.world.pickWeighted(ai.spawnWeights);
}

/**
 * Spawns one zombie (all spawns go through here): ECS body like the player plus `Zombie`, speed
 * spread and first wander pause from RNG `ai`. Returns the entity id.
 */
export function spawnZombie(
  w: SimWorld,
  ai: AiWorld,
  type: number,
  x: number,
  y: number,
  z: number,
): number {
  const c = w.c;
  const eid = spawnEntity(w);
  for (const comp of [
    c.Position,
    c.Velocity,
    c.Facing,
    c.Collider,
    c.MoveIntent,
    c.AimIntent,
    c.MoveStats,
    c.Zombie,
  ]) {
    attach(w, eid, comp);
  }
  const t = ai.types[type]!;
  const cfg = ai.cfg.ai;
  const rng = w.rng.ai;
  c.Position.x[eid] = Math.fround(x);
  c.Position.y[eid] = Math.fround(y);
  c.Position.z[eid] = z;
  c.Collider.radius[eid] = Math.fround(cfg.zombieRadius);
  c.Facing.angle[eid] = rng.int(0, 65535);
  c.MoveIntent.dx[eid] = 0;
  c.MoveIntent.dy[eid] = 0;
  c.MoveIntent.gait[eid] = 1;
  c.AimIntent.active[eid] = 0;
  c.MoveStats.speedPerTick[eid] = t.wanderPerTick;
  const z0 = c.Zombie;
  z0.is[eid] = 1;
  z0.type[eid] = type;
  z0.state[eid] = ZombieState.idle;
  z0.stateTick[eid] = w.tick + rng.int(0, secToTicks(cfg.wanderPauseSec.max) - 1);
  z0.targetId[eid] = 0;
  z0.tx[eid] = Math.fround(x);
  z0.ty[eid] = Math.fround(y);
  z0.memoryUntil[eid] = 0;
  z0.alert[eid] = 0;
  z0.hp[eid] = Math.fround(t.def.health);
  z0.speedMul[eid] = Math.fround(1 + cfg.speedSpread * (2 * rng.nextFloat() - 1));
  z0.stuck[eid] = 0;
  ai.zombieCount++;
  addPhysicsBody(w, eid);
  return eid;
}

/**
 * Spawns zombies from a list (`createSim({ spawnZombies })`, worker `init.zombies`). Unknown
 * types are skipped. Positions are used as given (callers pick free tiles).
 */
export function spawnZombies(w: SimWorld, spawns: readonly SimZombieSpawn[]): number[] {
  const ai = w.ai;
  if (!ai) return [];
  const out: number[] = [];
  for (const s of spawns) {
    const type = pickZombieType(w, ai, s.type);
    if (type < 0) continue;
    out.push(spawnZombie(w, ai, type, s.x, s.y, s.z ?? 0));
  }
  return out;
}

/**
 * Up to `count` free tile centres around (x, y) in a square spiral (ring by ring, fixed order),
 * skipping void tiles and spots where a zombie would touch a wall. Deterministic.
 */
export function freeSpotsAround(
  grid: TileGrid,
  z: number,
  x: number,
  y: number,
  count: number,
  radius: number,
  maxRing = 32,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let ring = 0; ring <= maxRing && out.length < count; ring++) {
    for (let dy = -ring; dy <= ring && out.length < count; dy++) {
      for (let dx = -ring; dx <= ring && out.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const px = cx + dx + 0.5;
        const py = cy + dy + 0.5;
        if (!circleOverlaps(grid, z, px, py, radius)) out.push({ x: px, y: py });
      }
    }
  }
  return out;
}
