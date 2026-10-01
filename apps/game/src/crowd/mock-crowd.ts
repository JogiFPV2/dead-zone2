// TEMPORARY: wandering placeholder entities for the render load test (`?crowd=N`).
import type { FloorBounds } from '../sim/mock-step.js';
import {
  SNAPSHOT_ENTITY_STRIDE,
  SnapshotAnim,
  SnapshotEntityKind,
  SnapshotField,
} from '@deadzone/protocol';

export const CROWD_SPEED = 1.2;
/** Chance per tick to pick a new heading. */
export const CROWD_TURN_CHANCE = 0.05;
/** Stable ids of crowd entities start here (player ids stay below). */
export const CROWD_FIRST_ID = 1000;

/** Any seeded source of floats in [0, 1), e.g. `Rng` from @deadzone/sim. */
export interface RandomSource {
  nextFloat(): number;
}

/** Floats per wanderer: x, y, heading. */
const W = 3;

export interface Crowd {
  readonly count: number;
  /** x, y, heading per wanderer. */
  readonly state: Float32Array;
}

export function createCrowd(count: number, rng: RandomSource, b: FloorBounds): Crowd {
  const state = new Float32Array(count * W);
  for (let i = 0; i < count; i++) {
    state[i * W] = b.minX + rng.nextFloat() * (b.maxX - b.minX);
    state[i * W + 1] = b.minY + rng.nextFloat() * (b.maxY - b.minY);
    state[i * W + 2] = rng.nextFloat() * Math.PI * 2;
  }
  return { count, state };
}

/** Random walk: occasionally turn, walk at CROWD_SPEED, reflect off the bounds. */
export function stepCrowd(crowd: Crowd, rng: RandomSource, dtSec: number, b: FloorBounds): void {
  const s = crowd.state;
  for (let i = 0; i < crowd.count; i++) {
    const o = i * W;
    let h = s[o + 2] ?? 0;
    if (rng.nextFloat() < CROWD_TURN_CHANCE) h += (rng.nextFloat() - 0.5) * Math.PI;
    let x = (s[o] ?? 0) + Math.cos(h) * CROWD_SPEED * dtSec;
    let y = (s[o + 1] ?? 0) + Math.sin(h) * CROWD_SPEED * dtSec;
    if (x < b.minX || x > b.maxX) {
      h = Math.PI - h;
      x = Math.min(b.maxX, Math.max(b.minX, x));
    }
    if (y < b.minY || y > b.maxY) {
      h = -h;
      y = Math.min(b.maxY, Math.max(b.minY, y));
    }
    s[o] = x;
    s[o + 1] = y;
    s[o + 2] = h;
  }
}

/** Writes wanderers as snapshot entities [id, x, y, z = 0, facing, kind = zombie, anim = walk, hpPct = 1] starting at float `offset`. */
export function writeCrowd(crowd: Crowd, out: Float32Array, offset: number): void {
  const s = crowd.state;
  for (let i = 0; i < crowd.count; i++) {
    const o = offset + i * SNAPSHOT_ENTITY_STRIDE;
    out[o + SnapshotField.stableId] = CROWD_FIRST_ID + i;
    out[o + SnapshotField.x] = s[i * W] ?? 0;
    out[o + SnapshotField.y] = s[i * W + 1] ?? 0;
    out[o + SnapshotField.z] = 0;
    out[o + SnapshotField.facingRad] = s[i * W + 2] ?? 0;
    out[o + SnapshotField.kind] = SnapshotEntityKind.zombie;
    out[o + SnapshotField.anim] = SnapshotAnim.walk;
    out[o + SnapshotField.hpPct] = 1;
  }
}

/** Parses `?crowd=N` (clamped to 0..5000); 0 if absent or invalid. */
export function parseCrowdParam(search: string): number {
  const raw = new URLSearchParams(search).get('crowd');
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(5000, Math.max(0, n)) : 0;
}
