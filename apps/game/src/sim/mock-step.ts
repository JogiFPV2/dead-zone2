// TEMPORARY STUB: stand-in for packages/sim movement until its API lands. No collisions.
import { PLAYER_RADIUS } from '@deadzone/sim';
import type { EntityState } from './snapshot.js';

export const MOCK_TICK_HZ = 20;
export const MOCK_TICK_MS = 1000 / MOCK_TICK_HZ;
export const MOCK_SPEED = 4;

export interface FloorBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MockInput {
  dx: number;
  dy: number;
  aim: { x: number; y: number } | undefined;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** One fixed tick: move at MOCK_SPEED, clamp to bounds (inset by radius), face the aim point. */
export function stepMockPlayer(
  p: EntityState,
  input: MockInput,
  dtSec: number,
  bounds: FloorBounds,
): EntityState {
  const len = Math.hypot(input.dx, input.dy);
  const k = len > 1 ? 1 / len : 1;
  const x = clamp(
    p.x + input.dx * k * MOCK_SPEED * dtSec,
    bounds.minX + PLAYER_RADIUS,
    bounds.maxX - PLAYER_RADIUS,
  );
  const y = clamp(
    p.y + input.dy * k * MOCK_SPEED * dtSec,
    bounds.minY + PLAYER_RADIUS,
    bounds.maxY - PLAYER_RADIUS,
  );
  let facing = p.facing;
  if (input.aim) {
    const ax = input.aim.x - x;
    const ay = input.aim.y - y;
    if (ax * ax + ay * ay > 1e-6) facing = Math.atan2(ay, ax);
  }
  return { ...p, x, y, facing };
}
