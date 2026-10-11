import { sortedQuery, type SimWorld } from '../core/world.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';
import { lineOfSight } from '../world/los.js';
import { despawnZombie, foldZombie } from './system.js';

/**
 * Safe start on generated maps (`createSim({ safeStart })`): for the first `sec` seconds of a new
 * game no zombie stands within `radiusTiles` of a player (any level) and none is in a player's
 * line of sight within `sightTiles` (same level, walls block). Spawns (LOD cells, start list)
 * skip such spots, and a zombie that walks into the zone is folded back into its LOD cell (or
 * removed without LOD) before the snapshot, so the player never sees it.
 */
export interface SafeStartOptions {
  /** Default 40 (tiles = metres). */
  radiusTiles?: number | undefined;
  /** Default 60. */
  sec?: number | undefined;
  /** Line-of-sight check distance; default 64 (beyond the daylight player sight of 30). */
  sightTiles?: number | undefined;
}

export interface SafeStart {
  readonly radiusTiles: number;
  readonly sightTiles: number;
  /** First tick without the protection. */
  readonly untilTick: number;
}

export const SAFE_START_RADIUS_TILES = 40;
export const SAFE_START_SEC = 60;
export const SAFE_START_SIGHT_TILES = 64;

export function safeStartOf(o: SafeStartOptions, tick: number, tps: number): SafeStart {
  return {
    radiusTiles: o.radiusTiles ?? SAFE_START_RADIUS_TILES,
    sightTiles: Math.max(o.sightTiles ?? SAFE_START_SIGHT_TILES, o.radiusTiles ?? 0),
    untilTick: tick + Math.round((o.sec ?? SAFE_START_SEC) * tps),
  };
}

/** The protection in force this tick, if any. */
export const safeStartActive = (w: SimWorld): SafeStart | undefined =>
  w.safeStart && w.tick < w.safeStart.untilTick ? w.safeStart : undefined;

/** True when a zombie at (x, y, z) would break the safe start for some living player. */
export function unsafeSpot(
  w: SimWorld,
  grid: TileGrid,
  s: SafeStart,
  x: number,
  y: number,
  z: number,
): boolean {
  const { Position } = w.c;
  const r2 = s.radiusTiles * s.radiusTiles;
  const sight2 = s.sightTiles * s.sightTiles;
  for (const p of w.players.values()) {
    if (w.survival?.dead[p]) continue;
    const px = Position.x[p] ?? 0;
    const py = Position.y[p] ?? 0;
    const d2 = (px - x) * (px - x) + (py - y) * (py - y);
    if (d2 < r2) return true;
    if (
      d2 < sight2 &&
      floorZ(w, p) === Math.floor(z) &&
      lineOfSight(grid, Math.floor(z), px, py, x, y)
    )
      return true;
  }
  return false;
}

/**
 * Pipeline step `safeStart` (after `physics`, before anything reads final positions): removes
 * zombies standing in the protected zone. No-op once the protection ends.
 */
export function safeStartSystem(w: SimWorld, grid: TileGrid): void {
  const s = safeStartActive(w);
  if (!s || !w.ai) return;
  const { Position, Zombie } = w.c;
  const out: number[] = [];
  for (const eid of sortedQuery(w, 'zombies', [Zombie])) {
    if (unsafeSpot(w, grid, s, Position.x[eid] ?? 0, Position.y[eid] ?? 0, floorZ(w, eid)))
      out.push(eid);
  }
  for (const eid of out) {
    if (w.lod) foldZombie(w, w.lod, eid);
    else despawnZombie(w, eid);
  }
}
