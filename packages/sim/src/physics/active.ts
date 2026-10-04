import { CHUNK_SIZE } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import type { PhysicsBody } from './types.js';

/**
 * Active chunks (large maps, ~8 × 8 km): physics runs only for bodies in a window of chunks
 * around each player — (2R + 1) × (2R + 1) chunks centred on the player's chunk, all levels.
 * R reuses the AI simulation radius: `ceil(ai.farTiles / 32)` (64 tiles → R = 2), so every body
 * within `farTiles` of a player is always simulated (`physics.activeChunkRadius` overrides it).
 *
 * Bodies outside every window are frozen: no state timers, knock-back slide, separation, crowd
 * pressure, stairs, falls or vaults, and no movement: `physicsCanMove` is false, so
 * `ai.locomotion` zeroes the intent and plans no path, and the movement modifier gives speed × 0.
 * The AI still thinks (rarely, far mode) and re-plans after the thaw. Their timers count active ticks only: when a body
 * comes back into a window, `stateStartTick` moves forward by the frozen ticks, so a knock-down
 * (or a fall, a vault) continues with the time it had left. `frozenAt` (tick of freezing, −1 =
 * active) is body state: saved and hashed (only while frozen, so small maps keep their hashes).
 */

/** Chunk windows of this tick as (cx, cy, r) triples (transient, `updateActiveWindows`). */
const windows: number[] = [];

export function activeChunkRadius(w: SimWorld): number {
  return w.physics.cfg.activeChunkRadius ?? Math.ceil((w.ai?.cfg.ai.farTiles ?? 64) / CHUNK_SIZE);
}

/**
 * Collects the chunks of all players, plus their `setInterest` areas (docs 9.24; radius = the
 * larger of the interest radius and R), once per physics tick, before `isActive`.
 */
export function updateActiveWindows(w: SimWorld): void {
  windows.length = 0;
  const radius = activeChunkRadius(w);
  const { Position } = w.c;
  for (const eid of w.players.values()) {
    windows.push(
      Math.floor((Position.x[eid] ?? 0) / CHUNK_SIZE),
      Math.floor((Position.y[eid] ?? 0) / CHUNK_SIZE),
      radius,
    );
  }
  if (windows.length === 0) return;
  for (const id of [...w.interest.keys()].sort((a, b) => a - b)) {
    const it = w.interest.get(id)!;
    windows.push(it.cx, it.cy, Math.max(radius, it.r));
  }
}

/** (x, y) in tiles lies in some window (without players: everything is active). */
export function isActive(x: number, y: number): boolean {
  if (windows.length === 0) return true;
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  for (let i = 0; i < windows.length; i += 3) {
    const r = windows[i + 2]!;
    if (Math.abs(cx - windows[i]!) <= r && Math.abs(cy - windows[i + 1]!) <= r) return true;
  }
  return false;
}

export const isFrozen = (b: PhysicsBody): boolean => b.frozenAt >= 0;

/** Freezes / thaws `b` for this tick; true when it is active. */
export function updateFrozen(b: PhysicsBody, active: boolean, tick: number): boolean {
  if (!active) {
    if (!(b.frozenAt >= 0)) {
      b.frozenAt = tick;
      b.pushX = 0;
      b.pushY = 0;
    }
    return false;
  }
  if (b.frozenAt >= 0) {
    // Timers count active ticks only: the state continues where it stopped.
    if (b.stateDuration > 0 || b.state === 'fall') b.stateStartTick += tick - b.frozenAt;
    b.frozenAt = -1;
  }
  return true;
}
