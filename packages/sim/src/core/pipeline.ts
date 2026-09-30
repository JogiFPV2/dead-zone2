import { clockSystem, type MinuteTicks } from '../systems/clock.js';
import { healthSystem } from '../systems/health.js';
import { inputSystem } from '../systems/input.js';
import { lifecycleSystem } from '../systems/lifecycle.js';
import { moodlesSystem } from '../systems/moodles.js';
import { facingSystem, movementSystem } from '../systems/movement.js';
import { sleepSystem } from '../systems/sleep.js';
import { survivalSystem } from '../systems/survival.js';
import type { TileGrid } from '../world/grid.js';
import type { SimWorld } from './world.js';

export interface SystemContext {
  grid: TileGrid;
  /** Written by `clock` every tick: game minutes the per-minute systems process now. */
  minutes: MinuteTicks;
  /** Ambient temperature in °C (weather later). */
  ambientC: number;
}

/**
 * The only list of systems, run in this order every tick (docs/sim-architecture.md 2.3).
 * Changing the order changes golden hashes and needs a doc update. Survival systems are no-ops
 * when the sim has no content.
 */
export const PIPELINE: readonly { name: string; run: (w: SimWorld, ctx: SystemContext) => void }[] =
  [
    { name: 'commands.apply', run: (w) => inputSystem(w) },
    { name: 'clock', run: (w, ctx) => clockSystem(w, ctx.minutes) },
    { name: 'movement', run: (w, ctx) => movementSystem(w, ctx.grid) },
    { name: 'movement.facing', run: (w) => facingSystem(w) },
    { name: 'health', run: (w, ctx) => healthSystem(w, ctx.minutes.first, ctx.minutes.count) },
    {
      name: 'survival',
      run: (w, ctx) => survivalSystem(w, ctx.minutes.first, ctx.minutes.count, ctx.ambientC),
    },
    { name: 'sleep', run: (w, ctx) => sleepSystem(w, ctx.minutes.first, ctx.minutes.count) },
    { name: 'moodles', run: (w, ctx) => moodlesSystem(w, ctx.minutes.count > 0) },
    { name: 'lifecycle', run: (w) => lifecycleSystem(w) },
  ];
