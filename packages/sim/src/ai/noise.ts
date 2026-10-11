import {
  GAITS,
  PLAYER_NOISE_CONTINUOUS,
  PLAYER_NOISE_KINDS,
  PLAYER_NOISE_MIN_TICKS,
  type NoiseSource,
  type PlayerNoiseKind,
} from '@deadzone/protocol';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { footstepRadius, sneakStepXp } from './sneak.js';
import { edgesBetween } from '../world/los.js';
import type { TileGrid } from '../world/grid.js';
import { noiseSourceIndex, type AiWorld, type Noise } from './state.js';
import { floorZ } from '../world/levels.js';

/**
 * Noise buffer (docs 2.5 `noise`). Anything that makes a sound calls `emitNoise`; zombies read
 * the buffer when they think (every few ticks), sleeping players when it is emitted. Walls damp
 * the effective radius (× `noise.wallMul` per wall or window on the straight line, DDA over the
 * edges), no propagation through rooms in the demo. Between floors (z = floor index, fractional z
 * on stairs counts as `Math.floor(z)`): × `noise.floorMul` per floor of difference, up to
 * `noise.maxFloors` floors (`worldSettings.noise`); walls are counted on the listener's floor.
 *
 * `by` = the player character that made the noise: also pushes a `playerNoise` event (production
 * builds too) with the exact values the AI hears; continuous kinds are throttled to one per
 * `PLAYER_NOISE_MIN_TICKS` per player and kind (the throttle never touches the AI noise).
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
  by?: PlayerNoiseBy,
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
  if (by) pushPlayerNoise(w, ai, n, by);
}

/** Who made a noise (player eid) and what kind it was, for `playerNoise`. */
export interface PlayerNoiseBy {
  eid: number;
  kind: PlayerNoiseKind;
}

const CONTINUOUS = new Set<PlayerNoiseKind>(PLAYER_NOISE_CONTINUOUS);

function pushPlayerNoise(w: SimWorld, ai: AiWorld, n: Noise, by: PlayerNoiseBy): void {
  const playerId = w.c.Player.id[by.eid] ?? 0;
  if (w.players.get(playerId) !== by.eid) return;
  if (CONTINUOUS.has(by.kind)) {
    const key = by.eid * 64 + PLAYER_NOISE_KINDS.indexOf(by.kind);
    const last = ai.playerNoiseTick.get(key);
    if (last !== undefined && w.tick - last < PLAYER_NOISE_MIN_TICKS && w.tick >= last) return;
    ai.playerNoiseTick.set(key, w.tick);
  }
  w.events.push({
    type: 'playerNoise',
    tick: w.tick,
    playerId,
    x: n.x,
    y: n.y,
    z: n.z,
    radius: n.radius,
    loudness: n.volume,
    kind: by.kind,
  });
}

/** Footstep kind of a gait (`walk` → `step`). */
export const footstepKind = (gait: string): PlayerNoiseKind =>
  gait === 'sneak' ? 'sneak' : gait === 'run' ? 'run' : gait === 'sprint' ? 'sprint' : 'step';

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
 * every `footstepEveryTicks` (`footstepRadius`: gait radius × sneaking / lightfoot skills × stat
 * `footstep-noise`); sneak footsteps near zombies give sneaking XP (ai/sneak.ts).
 */
export function footstepSystem(w: SimWorld): void {
  const ai = w.ai;
  if (!ai) return;
  const cfg = ai.cfg.noise;
  const { Position, Velocity, MoveIntent, StableId } = w.c;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if ((Velocity.x[eid] ?? 0) === 0 && (Velocity.y[eid] ?? 0) === 0) continue;
    if ((w.tick + (StableId.value[eid] ?? 0)) % cfg.footstepEveryTicks !== 0) continue;
    const gait = GAITS[MoveIntent.gait[eid] ?? 1] ?? 'walk';
    const f = cfg.footsteps[gait === 'sprint' ? 'run' : gait];
    const radius = footstepRadius(w, eid, gait);
    if (gait === 'sneak') sneakStepXp(w, eid);
    emitNoise(
      w,
      Position.x[eid] ?? 0,
      Position.y[eid] ?? 0,
      floorZ(w, eid),
      radius,
      f.volume,
      'footstep',
      0,
      { eid, kind: footstepKind(gait) },
    );
  }
}
