import { GAITS, type NoiseSource } from '@deadzone/protocol';
import { ModSlot } from '../content/adapter.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { modded } from '../survival/state.js';
import { edgesBetween } from '../world/los.js';
import type { TileGrid } from '../world/grid.js';
import { noiseSourceIndex, type AiWorld, type Noise } from './state.js';

/**
 * Noise buffer (docs 2.5 `noise`). Anything that makes a sound calls `emitNoise`; zombies read
 * the buffer when they think (every few ticks), sleeping players when it is emitted. Walls damp
 * the effective radius (× `noise.wallMul` per wall or window on the straight line, DDA over the
 * edges), no propagation through rooms in the demo. Between floors (z = floor index, fractional z
 * on stairs counts as `Math.floor(z)`): × `noise.floorMul` per floor of difference, up to
 * `noise.maxFloors` floors (`worldSettings.noise`); walls are counted on the listener's floor.
 */
export function emitNoise(
  w: SimWorld,
  x: number,
  y: number,
  z: number,
  radius: number,
  volume: number,
  source: NoiseSource,
  lingerSec = 0,
): void {
  const ai = w.ai;
  if (!ai || radius <= 0) return;
  const n: Noise = {
    tick: w.tick,
    x: Math.fround(x),
    y: Math.fround(y),
    z: Math.floor(z),
    radius: Math.fround(radius),
    volume: Math.fround(volume),
    source: noiseSourceIndex(source),
    lingerSec: Math.fround(lingerSec),
  };
  ai.noises.push(n);
  if (w.dev) {
    w.events.push({
      type: 'noise',
      tick: w.tick,
      x: n.x,
      y: n.y,
      z: n.z,
      radiusTiles: n.radius,
      volume: n.volume,
      source,
    });
  }
}

/**
 * Effective radius of `n` for a listener at (x, y, z) with hearing range `hearing` (tiles):
 * radius × hearing / reference × floorMul^floors × wallMul^walls (walls on the listener's floor);
 * 0 more than `maxFloors` floors away.
 */
export function heardRadius(
  ai: AiWorld,
  grid: TileGrid,
  n: Noise,
  x: number,
  y: number,
  z: number,
  hearing: number,
): number {
  const cfg = ai.cfg.noise;
  const floor = Math.floor(z);
  const floors = Math.abs(floor - n.z);
  if (floors > cfg.maxFloors) return 0;
  let r = (n.radius * hearing) / cfg.referenceHearingTiles;
  for (let i = floors; i > 0; i--) r *= cfg.floorMul;
  if (r <= 0) return 0;
  const dx = x - n.x;
  const dy = y - n.y;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return 0;
  let out = r;
  for (let i = edgesBetween(grid, floor, n.x, n.y, x, y, cfg.maxWalls); i > 0; i--)
    out *= cfg.wallMul;
  return out;
}

export const heard = (
  ai: AiWorld,
  grid: TileGrid,
  n: Noise,
  x: number,
  y: number,
  z: number,
  hearing: number,
): boolean => {
  const r = heardRadius(ai, grid, n, x, y, z, hearing);
  if (r <= 0) return false;
  const dx = x - n.x;
  const dy = y - n.y;
  return dx * dx + dy * dy <= r * r;
};

/** Pipeline `noise.collect`: drops noises older than the slowest think interval. */
export function noiseCollectSystem(w: SimWorld): void {
  const ai = w.ai;
  if (!ai || ai.noises.length === 0) return;
  const keepFrom = w.tick - ai.cfg.ai.farThinkEveryTicks;
  if ((ai.noises[0]?.tick ?? 0) >= keepFrom) return;
  ai.noises = ai.noises.filter((n) => n.tick >= keepFrom);
}

/**
 * Pipeline `noise.footsteps` (after movement): players that actually moved make a footstep noise
 * every `footstepEveryTicks` (gait radius × stat `footstep-noise`).
 */
export function footstepSystem(w: SimWorld): void {
  const ai = w.ai;
  const s = w.survival;
  if (!ai) return;
  const cfg = ai.cfg.noise;
  const { Position, Velocity, MoveIntent, StableId } = w.c;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if ((Velocity.x[eid] ?? 0) === 0 && (Velocity.y[eid] ?? 0) === 0) continue;
    if ((w.tick + (StableId.value[eid] ?? 0)) % cfg.footstepEveryTicks !== 0) continue;
    const gait = GAITS[MoveIntent.gait[eid] ?? 1] ?? 'walk';
    const f = cfg.footsteps[gait];
    const radius = s ? modded(s, eid, ModSlot['footstep-noise'], f.radiusTiles) : f.radiusTiles;
    emitNoise(
      w,
      Position.x[eid] ?? 0,
      Position.y[eid] ?? 0,
      Position.z[eid] ?? 0,
      radius,
      f.volume,
      'footstep',
    );
  }
}
