export { createRng, type Rng } from './rng.js';

/** Fixed simulation tick rate (PLAN.md: 20 Hz). */
export const TICK_RATE_HZ = 20;
export const TICK_MS = 1000 / TICK_RATE_HZ;
