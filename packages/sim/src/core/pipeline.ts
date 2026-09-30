import { facingSystem, movementSystem } from '../systems/movement.js';
import { inputSystem } from '../systems/input.js';
import type { TileGrid } from '../world/grid.js';
import type { SimWorld } from './world.js';

export interface SystemContext {
  grid: TileGrid;
}

/**
 * The only list of systems, run in this order every tick (docs/sim-architecture.md 2.3).
 * Changing the order changes golden hashes and needs a doc update.
 */
export const PIPELINE: readonly { name: string; run: (w: SimWorld, ctx: SystemContext) => void }[] =
  [
    { name: 'commands.apply', run: (w) => inputSystem(w) },
    { name: 'movement', run: (w, ctx) => movementSystem(w, ctx.grid) },
    { name: 'movement.facing', run: (w) => facingSystem(w) },
  ];
