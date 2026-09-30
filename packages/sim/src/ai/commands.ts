import type { Command, CommandRejectReason } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { TileGrid } from '../world/grid.js';
import { emitNoise } from './noise.js';
import { freeSpotsAround, pickZombieType, spawnZombie } from './zombies.js';

type AiCommand = Extract<Command, { type: 'debugSpawnZombie' | 'debugNoise' }>;

export const isAiCommand = (cmd: Command): cmd is AiCommand =>
  cmd.type === 'debugSpawnZombie' || cmd.type === 'debugNoise';

const grids = new WeakMap<object, TileGrid>();
const gridOf = (w: SimWorld): TileGrid => {
  let g = grids.get(w.map);
  if (!g) {
    g = new TileGrid(w.map);
    grids.set(w.map, g);
  }
  return g;
};

/** Dev commands of Stage 4 (spawning zombies, test noises). */
export function applyAiCommand(
  w: SimWorld,
  _eid: number,
  cmd: AiCommand,
): CommandRejectReason | undefined {
  if (!w.dev) return 'dev-only';
  const ai = w.ai;
  if (!ai) return 'invalid-state';
  const z = cmd.z ?? 0;
  if (cmd.type === 'debugNoise') {
    emitNoise(w, cmd.x, cmd.y, z, cmd.radiusTiles, cmd.volume ?? 1, 'debug');
    return undefined;
  }
  const count = cmd.count ?? 1;
  if (cmd.zombieType !== undefined && pickZombieType(w, ai, cmd.zombieType) < 0) {
    return 'unknown-item';
  }
  if (ai.types.length === 0) return 'invalid-state';
  const spots = freeSpotsAround(gridOf(w), z, cmd.x, cmd.y, count, ai.cfg.ai.zombieRadius);
  if (spots.length === 0) return 'invalid-target';
  for (const p of spots) {
    const type = pickZombieType(w, ai, cmd.zombieType);
    spawnZombie(w, ai, type, p.x, p.y, z);
  }
  return undefined;
}
