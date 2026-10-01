/**
 * Gameplay physics (players and zombies): mass and inertia, load / endurance speed modifiers,
 * knock-back, stagger, knock-down and getting up. Deterministic (fixed tick, seeded RNG only).
 *
 * TODO(movement): not wired into `core/pipeline.ts` yet. Movement (`systems/movement.ts`) is being
 * reworked on `sim/storage-movement` (acceleration, turning, `registerMovementModifier`). Plan:
 * keep a `PhysicsWorld` on `SimWorld`, register `physicsSpeedMul` / `physicsAccelMul` as a
 * movement modifier, run `physicsStep` right after `movement.facing`, and feed it hits from
 * `combat` (swing / shove / zombie attack).
 */
export * from './constants.js';
export * from './types.js';
export * from './modifiers.js';
export * from './reactions.js';
export * from './step.js';
