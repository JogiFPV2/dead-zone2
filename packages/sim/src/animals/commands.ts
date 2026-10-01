import type { Command, CommandRejectReason } from '@deadzone/protocol';
import { gridOf } from '../ai/commands.js';
import { freeSpotsAround } from '../ai/zombies.js';
import type { SimWorld } from '../core/world.js';
import { pickAnimalType, spawnAnimal } from './spawn.js';

type AnimalCommand = Extract<Command, { type: 'debugSpawnAnimal' }>;

export const isAnimalCommand = (cmd: Command): cmd is AnimalCommand =>
  cmd.type === 'debugSpawnAnimal';

/**
 * Dev `debugSpawnAnimal {x, y, z?, count?, animalType?}`: `count` animals on free tiles in a
 * spiral around (x, y); the type is the given id or weighted by `spawnWeight` (RNG `animals`).
 */
export function applyAnimalCommand(
  w: SimWorld,
  cmd: AnimalCommand,
): CommandRejectReason | undefined {
  if (!w.dev) return 'dev-only';
  const ai = w.ai;
  if (!ai) return 'invalid-state';
  if (cmd.animalType !== undefined && pickAnimalType(w, ai, cmd.animalType) < 0) {
    return 'unknown-item';
  }
  if (ai.animalTypes.length === 0) return 'invalid-state';
  const z = cmd.z ?? 0;
  let radius = 0;
  for (const t of ai.animalTypes) radius = Math.max(radius, t.def.radiusTiles);
  const spots = freeSpotsAround(gridOf(w), z, cmd.x, cmd.y, cmd.count ?? 1, radius);
  if (spots.length === 0) return 'invalid-target';
  for (const p of spots) spawnAnimal(w, ai, pickAnimalType(w, ai, cmd.animalType), p.x, p.y, z);
  return undefined;
}
