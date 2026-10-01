import { actionsSystem } from '../actions/queue.js';
import { aiThinkSystem } from '../ai/brain.js';
import { combatSystem } from '../combat/system.js';
import { aiLocomotionSystem } from '../ai/locomotion.js';
import { animalSystem } from '../animals/system.js';
import { footstepSystem, noiseCollectSystem } from '../ai/noise.js';
import { threatSystem } from '../ai/threat.js';
import { navSystem } from '../nav/system.js';
import { clockSystem, type MinuteTicks } from '../systems/clock.js';
import { healthSystem } from '../systems/health.js';
import { inputSystem } from '../systems/input.js';
import { lureSystem } from '../lures/lures.js';
import { inventorySystem } from '../systems/inventory.js';
import { lifecycleSystem } from '../systems/lifecycle.js';
import { moodlesSystem } from '../systems/moodles.js';
import { penaltiesSystem } from '../survival/penalties.js';
import { physicsSystem } from '../physics/system.js';
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
    { name: 'commands.apply', run: (w, ctx) => inputSystem(w, ctx.grid) },
    { name: 'clock', run: (w, ctx) => clockSystem(w, ctx.minutes) },
    { name: 'actions', run: (w) => actionsSystem(w) },
    { name: 'lures', run: (w, ctx) => lureSystem(w, ctx.grid) },
    { name: 'noise.collect', run: (w) => noiseCollectSystem(w) },
    { name: 'ai.brain', run: (w, ctx) => aiThinkSystem(w, ctx.grid) },
    { name: 'nav', run: (w, ctx) => navSystem(w, ctx.grid) },
    { name: 'ai.locomotion', run: (w, ctx) => aiLocomotionSystem(w, ctx.grid) },
    { name: 'animals', run: (w, ctx) => animalSystem(w, ctx.grid) },
    { name: 'movement', run: (w, ctx) => movementSystem(w, ctx.grid) },
    { name: 'movement.facing', run: (w) => facingSystem(w) },
    { name: 'physics', run: (w, ctx) => physicsSystem(w, ctx.grid) },
    { name: 'noise.footsteps', run: (w) => footstepSystem(w) },
    { name: 'ai.threat', run: (w, ctx) => threatSystem(w, ctx.grid) },
    { name: 'inventory', run: (w) => inventorySystem(w) },
    { name: 'health', run: (w, ctx) => healthSystem(w, ctx.minutes.first, ctx.minutes.count) },
    {
      name: 'survival',
      run: (w, ctx) => survivalSystem(w, ctx.minutes.first, ctx.minutes.count, ctx.ambientC),
    },
    { name: 'sleep', run: (w, ctx) => sleepSystem(w, ctx.minutes.first, ctx.minutes.count) },
    { name: 'moodles', run: (w, ctx) => moodlesSystem(w, ctx.minutes.count > 0) },
    { name: 'penalties', run: (w) => penaltiesSystem(w) },
    { name: 'combat', run: (w, ctx) => combatSystem(w, ctx.grid) },
    { name: 'lifecycle', run: (w) => lifecycleSystem(w) },
  ];
