import {
  CHUNK_SIZE,
  GAITS,
  STEALTH_DIM_MAX,
  STEALTH_HIDDEN_MAX,
  type StealthLevel,
} from '@deadzone/protocol';
import { gameMinuteAt } from '../core/clock.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';
import { LIGHT, sightFactor, sunState, type SunState } from './sky.js';

export { LIGHT };
import { sneakVisibilityMul } from './sneak.js';
import type { AiWorld } from './state.js';
import { inDarkZone, lightAt } from './vision.js';

/**
 * Light and hiding (docs 9.45). One model with the renderer: the sun comes from `sunAt`
 * (`@deadzone/protocol`, Stalowa Wola, the same function the client uses for the sun light and
 * shadows). Light level 0..1 at a point = max(sky light × building shadow / indoors / dark zone,
 * artificial lights). Sky: `LIGHT.moon` at night, 1 by day, linear while the sun is between −6°
 * and +6° (civil twilight). Shadow: a ray from the point towards the sun over the tile grid hits a
 * building taller than the ray (levels × `LIGHT.levelHeightM`); masks are cached per chunk and
 * game quarter-hour. Indoors (a room tile) the sky is × `LIGHT.indoorMul`.
 *
 * Visibility of a player to zombies = sight factor of the light (`nightFactor` at moonlight, 1 in
 * full light) × motion (standing still in the dark ≈ invisible, `LIGHT.stillDarkMul`) × sneaking.
 * Light levels of players are recomputed every `LIGHT.everyTicks` (pipeline `light`, saved in
 * `AiWorld.lightLevel`), visibility every tick from it.
 */
// Building heights (levels with floor on a building tile) and shadow masks, per chunk.
interface ChunkLight {
  heights: Uint8Array | undefined;
  quarter: number;
  shadow: Uint8Array | undefined;
}
const chunkCache = new WeakMap<TileGrid, Map<number, ChunkLight>>();
const MAX_LEVELS = 16;

function chunkLight(grid: TileGrid, cx: number, cy: number): ChunkLight {
  let m = chunkCache.get(grid);
  if (!m) chunkCache.set(grid, (m = new Map<number, ChunkLight>()));
  const key = (cx + 0x8000) * 0x10000 + (cy + 0x8000);
  let c = m.get(key);
  if (!c) m.set(key, (c = { heights: undefined, quarter: -1, shadow: undefined }));
  return c;
}

/** Building height in levels at a ground tile (0 = open ground). */
function heightAt(grid: TileGrid, tx: number, ty: number): number {
  const cx = Math.floor(tx / CHUNK_SIZE);
  const cy = Math.floor(ty / CHUNK_SIZE);
  const c = chunkLight(grid, cx, cy);
  if (!c.heights) {
    const hs = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const gx = cx * CHUNK_SIZE + lx;
        const gy = cy * CHUNK_SIZE + ly;
        if (grid.roomAt(gx, gy, 0) === 0) continue;
        let n = 1;
        if (grid.multiLevel) while (n < MAX_LEVELS && !grid.isVoid(gx, gy, n)) n++;
        hs[ly * CHUNK_SIZE + lx] = n;
      }
    }
    c.heights = hs;
  }
  return c.heights[(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)] ?? 0;
}

/** Ray from the ground tile towards the sun blocked by a taller building (no cache). */
function shadowRay(grid: TileGrid, sun: SunState, tx: number, ty: number): boolean {
  if (!sun.up || sun.tanEl <= 0) return false;
  const x0 = tx + 0.5;
  const y0 = ty + 0.5;
  const own = heightAt(grid, tx, ty);
  for (let d = 1; d <= LIGHT.maxShadowTiles; d++) {
    const ray = LIGHT.bodyHeightM + d * sun.tanEl;
    if (ray > MAX_LEVELS * LIGHT.levelHeightM) return false;
    const h = heightAt(grid, Math.floor(x0 + sun.hx * d), Math.floor(y0 + sun.hy * d));
    if (h > own && h * LIGHT.levelHeightM > ray) return true;
  }
  return false;
}

/** Ground tile in a building's shadow now (mask per chunk and quarter-hour). */
export function inShadow(grid: TileGrid, sun: SunState, tx: number, ty: number): boolean {
  if (!sun.up) return false;
  const cx = Math.floor(tx / CHUNK_SIZE);
  const cy = Math.floor(ty / CHUNK_SIZE);
  const c = chunkLight(grid, cx, cy);
  if (c.quarter !== sun.quarter || !c.shadow) {
    const mask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let ly = 0; ly < CHUNK_SIZE; ly++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++)
        if (shadowRay(grid, sun, cx * CHUNK_SIZE + lx, cy * CHUNK_SIZE + ly))
          mask[ly * CHUNK_SIZE + lx] = 1;
    c.shadow = mask;
    c.quarter = sun.quarter;
  }
  return c.shadow[(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)] === 1;
}

/**
 * Light level 0..1 at (x, y) on level `z` now: sky (sun / twilight / moon) × shadow or indoors,
 * 0 in a `dark` zone, at least the brightest artificial light (lamps with power, held lights).
 */
export function lightLevelAt(
  w: SimWorld,
  ai: AiWorld,
  grid: TileGrid,
  x: number,
  y: number,
  z: number,
): number {
  const sun = sunState(gameMinuteAt(w.clock, w.tick));
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  let sky = sun.sky;
  if (inDarkZone(ai, tx, ty, z)) sky = 0;
  else if (grid.roomAt(tx, ty, z) !== 0) sky *= LIGHT.indoorMul;
  else if (z === 0 && inShadow(grid, sun, tx, ty)) sky *= LIGHT.shadowMul;
  return Math.fround(Math.max(sky, lightAt(w, ai, x, y, z)));
}

/** Pipeline `light` (before `ai.brain`): players' light levels every `LIGHT.everyTicks`. */
export function lightSystem(w: SimWorld, grid: TileGrid): void {
  const ai = w.ai;
  if (!ai) return;
  const { Position } = w.c;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if (w.tick % LIGHT.everyTicks !== 0 && (ai.lightLevel[eid] ?? -1) >= 0) continue;
    ai.lightLevel[eid] = lightLevelAt(
      w,
      ai,
      grid,
      Position.x[eid] ?? 0,
      Position.y[eid] ?? 0,
      floorZ(w, eid),
    );
  }
}

/**
 * How visible a player is to zombies (0 = invisible, 1 = full daylight range): sight factor of
 * the light at the player × motion (still in the dark ≈ 0.1, running more) × sneaking; 0 in a
 * `dark` zone without any light. `level` overrides the stored light level (views).
 */
export function playerVisibility(w: SimWorld, ai: AiWorld, eid: number, level?: number): number {
  if (w.survival?.dead[eid]) return 0;
  const vc = ai.cfg.vision;
  if (!vc.enabled) return 1;
  const light = level ?? ai.lightLevel[eid] ?? 1;
  const lightNow = light < 0 ? 1 : light;
  if (lightNow <= 0) return 0;
  const { Velocity, MoveIntent } = w.c;
  const still = (Velocity.x[eid] ?? 0) === 0 && (Velocity.y[eid] ?? 0) === 0;
  const gait = GAITS[MoveIntent.gait[eid] ?? 1];
  let motion = 1;
  if (still)
    motion =
      LIGHT.stillDarkMul + (1 - LIGHT.stillDarkMul) * Math.min(1, lightNow / LIGHT.stillFullLight);
  else if (gait === 'run') motion = LIGHT.runMul;
  else if (gait === 'sprint') motion = LIGHT.sprintMul;
  let v = Math.min(1, sightFactor(vc, lightNow) * motion);
  if (gait === 'sneak') v *= sneakVisibilityMul(w, eid);
  return Math.fround(v);
}

/** `stealth` of a visibility (thresholds `STEALTH_HIDDEN_MAX` / `STEALTH_DIM_MAX`). */
export const stealthOf = (vis: number): StealthLevel =>
  vis <= STEALTH_HIDDEN_MAX ? 'hidden' : vis <= STEALTH_DIM_MAX ? 'dim' : 'lit';
