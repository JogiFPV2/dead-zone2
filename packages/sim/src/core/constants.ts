/** Fixed simulation tick rate (PLAN.md: 20 Hz). Systems never receive a variable dt. */
export const TICKS_PER_SECOND = 20;
/** @deprecated alias kept for existing imports; use TICKS_PER_SECOND. */
export const TICK_RATE_HZ = TICKS_PER_SECOND;
export const TICK_MS = 1000 / TICKS_PER_SECOND;

/** Player walking speed in tiles per second (1 tile = 1 m). */
export const WALK_SPEED_TILES_PER_SECOND = 3;
/** Player collision capsule radius in tiles (2D circle, the capsule's vertical extent is ignored). */
export const PLAYER_RADIUS = 0.3;
/** Commands for ticks further in the future than this are rejected. */
export const COMMAND_WINDOW_TICKS = 40;
/** Default entity capacity of one world (component arrays are preallocated). */
export const DEFAULT_MAX_ENTITIES = 4096;
