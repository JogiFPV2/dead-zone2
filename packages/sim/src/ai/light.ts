import {
  CHUNK_SIZE,
  GAITS,
  STEALTH_DIM_MAX,
  STEALTH_HIDDEN_MAX,
  SIM_TREE_STRIDE,
  type StealthLevel,
} from '@deadzone/protocol';
import { gameMinuteAt } from '../core/clock.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';
import {
  cloudSoftened,
  LIGHT,
  sightFactor,
  skyLight,
  sunState,
  weatherSightMul,
  type SunState,
} from './sky.js';

export { LIGHT };
import { sneakVisibilityMul } from './sneak.js';
import type { AiWorld } from './state.js';
import { inDarkZone, lightAt } from './vision.js';
import { inLowShade } from './low-shade.js';

/**
 * Light and hiding (docs 9.45). One model with the renderer: the sun comes from `sunAt`
 * (`@deadzone/protocol`, Stalowa Wola, the same function the client uses for the sun light and
 * shadows). Light level 0..1 at a point = max(sky light × building shadow / indoors / dark zone,
 * artificial lights). Sky: `LIGHT.moon` at night, 1 by day, linear while the sun is between −6°
 * and +6° (civil twilight). Shadow: a ray from the point towards the sun over the tile grid hits a
 * building taller than the ray (levels × `LIGHT.levelHeightM`); masks are cached per chunk and
 * game quarter-hour. Cars, fences and walls cast short shadows (`low-shade.ts`, not cached; a
 * sneaking player is lower, so they hide behind them better). Tree crowns (`SimChunk.trees`) shade too, lighter (`LIGHT.treeShadeMul`): a
 * tile under a crown or whose ray passes through one. Indoors (a room tile) the sky is × `LIGHT.indoorMul`.
 *
 * Visibility of a player to zombies = sight factor of the light (`nightFactor` at moonlight, 1 in
 * full light) × motion (standing still in the dark ≈ invisible, `LIGHT.stillDarkMul`) × sneaking.
 * Light levels of players are recomputed every `LIGHT.everyTicks` (pipeline `light`, saved in
 * `AiWorld.lightLevel`), visibility every tick from it.
 */
// Building heights (levels with floor on a building tile) and shadow masks, per chunk.
interface ChunkLight {
  heights: Uint8Array | undefined;
  /** Tree crowns over each tile: lowest bottom and highest top in decimetres (top 0 = none). */
  canopyLo: Uint16Array | undefined;
  canopyHi: Uint16Array | undefined;
  quarter: number;
  /** 0 = sunlit, `SHADE_BUILDING` or `SHADE_TREE`. */
  shadow: Uint8Array | undefined;
}
const SHADE_BUILDING = 1;
const SHADE_TREE = 2;
const chunkCache = new WeakMap<TileGrid, Map<number, ChunkLight>>();
const MAX_LEVELS = 16;

function chunkLight(grid: TileGrid, cx: number, cy: number): ChunkLight {
  let m = chunkCache.get(grid);
  if (!m) chunkCache.set(grid, (m = new Map<number, ChunkLight>()));
  const key = (cx + 0x8000) * 0x10000 + (cy + 0x8000);
  let c = m.get(key);
  if (!c)
    m.set(
      key,
      (c = {
        heights: undefined,
        canopyLo: undefined,
        canopyHi: undefined,
        quarter: -1,
        shadow: undefined,
      }),
    );
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

/** Farthest a crown reaches out of its chunk (m); larger radii are clamped. */
const MAX_CROWN_M = 8;

/**
 * Tree crowns over a ground tile: `[bottom, top]` in decimetres in `out` (top 0 = no crown). A
 * tile is under a crown when its centre is within the crown radius of the trunk; overlapping
 * crowns merge (lowest bottom, highest top). Rasters per chunk from the 3 × 3 chunks around it.
 */
function canopyAt(grid: TileGrid, tx: number, ty: number, out: [number, number]): void {
  const cx = Math.floor(tx / CHUNK_SIZE);
  const cy = Math.floor(ty / CHUNK_SIZE);
  const c = chunkLight(grid, cx, cy);
  if (!c.canopyHi) {
    const lo = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    const hi = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let ny = cy - 1; ny <= cy + 1; ny++)
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        const list = grid.treesOf(nx, ny);
        if (!list) continue;
        for (let i = 0; i + SIM_TREE_STRIDE <= list.length; i += SIM_TREE_STRIDE) {
          // Tree centre relative to this chunk's origin (tiles = metres).
          const x = list[i]! + (nx - cx) * CHUNK_SIZE;
          const y = list[i + 1]! + (ny - cy) * CHUNK_SIZE;
          const r = Math.min(MAX_CROWN_M, Math.max(0, list[i + 2]!));
          const b = Math.max(0, Math.round(list[i + 3]! * 10));
          const t = Math.min(0xffff, Math.round(list[i + 4]! * 10));
          if (r <= 0 || t <= b) continue;
          const lx0 = Math.max(0, Math.floor(x - r));
          const lx1 = Math.min(CHUNK_SIZE - 1, Math.floor(x + r));
          const ly0 = Math.max(0, Math.floor(y - r));
          const ly1 = Math.min(CHUNK_SIZE - 1, Math.floor(y + r));
          for (let ly = ly0; ly <= ly1; ly++)
            for (let lx = lx0; lx <= lx1; lx++) {
              const dx = lx + 0.5 - x;
              const dy = ly + 0.5 - y;
              if (dx * dx + dy * dy > r * r) continue;
              const k = ly * CHUNK_SIZE + lx;
              if (hi[k] === 0 || b < lo[k]!) lo[k] = b;
              if (t > hi[k]!) hi[k] = t;
            }
        }
      }
    c.canopyLo = lo;
    c.canopyHi = hi;
  }
  const k = (ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE);
  out[0] = c.canopyLo![k] ?? 0;
  out[1] = c.canopyHi[k] ?? 0;
}

const crown: [number, number] = [0, 0];

/**
 * Ray from the ground tile towards the sun (no cache): `SHADE_BUILDING` when a taller building
 * blocks it, else `SHADE_TREE` when it passes through a tree crown (or the tile is under one),
 * else 0. A building wins over a tree (darker).
 */
function shadowRay(grid: TileGrid, sun: SunState, tx: number, ty: number): number {
  if (!sun.up || sun.tanEl <= 0) return 0;
  const x0 = tx + 0.5;
  const y0 = ty + 0.5;
  const own = heightAt(grid, tx, ty);
  canopyAt(grid, tx, ty, crown);
  let tree = crown[1] > 0;
  for (let d = 1; d <= LIGHT.maxShadowTiles; d++) {
    const ray = LIGHT.bodyHeightM + d * sun.tanEl;
    if (ray > MAX_LEVELS * LIGHT.levelHeightM) break;
    const gx = Math.floor(x0 + sun.hx * d);
    const gy = Math.floor(y0 + sun.hy * d);
    const h = heightAt(grid, gx, gy);
    if (h > own && h * LIGHT.levelHeightM > ray) return SHADE_BUILDING;
    if (!tree) {
      canopyAt(grid, gx, gy, crown);
      const dm = ray * 10;
      if (crown[1] > 0 && dm >= crown[0] && dm <= crown[1]) tree = true;
    }
  }
  return tree ? SHADE_TREE : 0;
}

/**
 * Shade of a ground tile now (mask per chunk and quarter-hour): 0 sunlit, 1 a building's
 * shadow, 2 the shade of tree crowns.
 */
export function shadeAt(grid: TileGrid, sun: SunState, tx: number, ty: number): number {
  if (!sun.up) return 0;
  const cx = Math.floor(tx / CHUNK_SIZE);
  const cy = Math.floor(ty / CHUNK_SIZE);
  const c = chunkLight(grid, cx, cy);
  if (c.quarter !== sun.quarter || !c.shadow) {
    const mask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let ly = 0; ly < CHUNK_SIZE; ly++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++)
        mask[ly * CHUNK_SIZE + lx] = shadowRay(
          grid,
          sun,
          cx * CHUNK_SIZE + lx,
          cy * CHUNK_SIZE + ly,
        );
    c.shadow = mask;
    c.quarter = sun.quarter;
  }
  return c.shadow[(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)] ?? 0;
}

/** Ground tile in a building's shadow now. */
export const inShadow = (grid: TileGrid, sun: SunState, tx: number, ty: number): boolean =>
  shadeAt(grid, sun, tx, ty) === SHADE_BUILDING;

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
  /** Height (m) the light is taken at: standing `LIGHT.bodyHeightM`, sneaking lower. */
  bodyM: number = LIGHT.bodyHeightM,
): number {
  const minute = gameMinuteAt(w.clock, w.tick);
  const sun = sunState(minute);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  let sky = skyLight(w, minute);
  if (inDarkZone(ai, tx, ty, z)) sky = 0;
  else if (grid.roomAt(tx, ty, z) !== 0) sky *= LIGHT.indoorMul;
  else if (z === 0) {
    const shade = shadeAt(grid, sun, tx, ty);
    if (shade === SHADE_BUILDING) sky *= cloudSoftened(w, LIGHT.shadowMul, minute);
    else if (inLowShade(w, grid, sun, x, y, bodyM))
      sky *= cloudSoftened(w, LIGHT.lowShadeMul, minute);
    else if (shade === SHADE_TREE) sky *= cloudSoftened(w, LIGHT.treeShadeMul, minute);
  }
  return Math.fround(Math.max(sky, lightAt(w, ai, x, y, z)));
}

/** Pipeline `light` (before `ai.brain`): players' light levels every `LIGHT.everyTicks`. */
export function lightSystem(w: SimWorld, grid: TileGrid): void {
  const ai = w.ai;
  if (!ai) return;
  const { Position, MoveIntent } = w.c;
  for (const eid of sortedQuery(w, 'players', [w.c.Player])) {
    if (w.tick % LIGHT.everyTicks !== 0 && (ai.lightLevel[eid] ?? -1) >= 0) continue;
    ai.lightLevel[eid] = lightLevelAt(
      w,
      ai,
      grid,
      Position.x[eid] ?? 0,
      Position.y[eid] ?? 0,
      floorZ(w, eid),
      GAITS[MoveIntent.gait[eid] ?? 1] === 'sneak' ? LIGHT.sneakBodyHeightM : LIGHT.bodyHeightM,
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
  const fog = weatherSightMul(w, gameMinuteAt(w.clock, w.tick));
  let v = Math.min(1, sightFactor(vc, lightNow, w.weather !== undefined) * motion * fog);
  if (gait === 'sneak') v *= sneakVisibilityMul(w, eid);
  return Math.fround(v);
}

/** `stealth` of a visibility (thresholds `STEALTH_HIDDEN_MAX` / `STEALTH_DIM_MAX`). */
export const stealthOf = (vis: number): StealthLevel =>
  vis <= STEALTH_HIDDEN_MAX ? 'hidden' : vis <= STEALTH_DIM_MAX ? 'dim' : 'lit';
