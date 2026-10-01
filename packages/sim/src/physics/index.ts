/**
 * Gameplay physics (players and zombies): mass and inertia, load / endurance speed modifiers,
 * knock-back, stagger, knock-down and getting up, crowd pressure on doors / windows / fences. Deterministic (fixed tick, seeded RNG only).
 *
 * Wired into the sim by `system.ts` (pipeline step `physics`, movement modifier, combat hits).
 */
export * from './constants.js';
export * from './types.js';
export * from './modifiers.js';
export * from './reactions.js';
export * from './step.js';
export * from './system.js';
export * from './crowd.js';
