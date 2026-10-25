/**
 * Low-resolution terrain of the whole map for the big map's far zooms (16 km square at 0,1×).
 *
 * The full paper map (`paper.ts`) only covers a window of loaded chunks and the per-pixel fog
 * costs the same at every zoom; drawing a 16 km world that way ran at ~1 fps. Instead every
 * chunk the client has seen is painted once into a tiled atlas at 4 m / px (8 × 8 px per chunk)
 * with two mip levels (8 m, 16 m / px), and the fog becomes a 1 px-per-chunk mask image. A
 * frame at far zoom is then a handful of `drawImage` calls; the atlas only changes when a new
 * chunk is painted and the mask only when the discovery bitmap changes.
 */
import { CHUNK_SIZE, tileIndex, type ChunkData } from '../world/chunk.js';
import { FOG_CHUNK_M, type FogGrid, type View, type Viewport } from './bigmap-model.js';
import { PAPER, paperKind, type PaperKind } from './paper.js';

/** Atlas pixels per chunk side at level 0 (4 m / px); level l has `CELLS >> l`. */
export const CELLS = 8;
/** Tiles per cell side (32 / 8 = 4 m). */
const CELL_M = CHUNK_SIZE / CELLS;
/** Atlas mip levels: 0 = 4 m / px, 1 = 8 m / px, 2 = 16 m / px. */
export const LEVELS = 3;
/** Chunks per atlas tile side (64 chunks = 2 048 m = 512 px at level 0). */
const TILE_CHUNKS = 64;

const KINDS = Object.keys(PAPER) as PaperKind[];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<PaperKind, number>;

/**
 * Paper class of every 4 × 4 m cell of a ground-floor chunk (`CELLS²`, row-major, `PAPER`
 * key index). Buildings (room tiles) win from 6 of 16 tiles, roads / rail from 3 (they are
 * thin), water from 8; otherwise the most common ground. Pure (tests).
 */
export function chunkCells(
  data: Pick<ChunkData, 'floor' | 'room' | 'roof'>,
  palette: readonly (string | null)[],
): Uint8Array {
  const out = new Uint8Array(CELLS * CELLS);
  const kindOf = new Map<number, number>();
  const kind = (id: number) => {
    let k = kindOf.get(id);
    if (k === undefined) {
      const pk = paperKind(palette[id]);
      k = pk === undefined ? K.base : K[pk];
      kindOf.set(id, k);
    }
    return k;
  };
  const counts = new Uint8Array(KINDS.length);
  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      counts.fill(0);
      let building = 0;
      for (let ty = 0; ty < CELL_M; ty++) {
        for (let tx = 0; tx < CELL_M; tx++) {
          const i = tileIndex(cx * CELL_M + tx, cy * CELL_M + ty);
          if (data.room?.[i] || (data.roof?.[i] ?? 0) !== 0) building++;
          counts[kind(data.floor[i] ?? 0)]!++;
        }
      }
      let k: number;
      if (building >= 6) k = K.building;
      else if (counts[K.road]! >= 3) k = K.road;
      else if (counts[K.rail]! >= 3) k = K.rail;
      else if (counts[K.water]! >= 8) k = K.water;
      else {
        k = K.base;
        let best = -1;
        for (let j = 0; j < counts.length; j++) {
          if (j === K.road || j === K.rail || j === K.floor) continue;
          if (counts[j]! > best) {
            best = counts[j]!;
            k = j;
          }
        }
        if (best === 0 && counts[K.floor]! > 0) k = K.floor;
      }
      out[cy * CELLS + cx] = k;
    }
  }
  return out;
}

const hash = (x: number, y: number): number => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** Cells → RGBA (`CELLS²` px) with the paper grain; `gx`, `gy` = global pixel of cell (0, 0). */
export function cellsToRgba(cells: Uint8Array, gx: number, gy: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CELLS * CELLS * 4);
  for (let i = 0; i < cells.length; i++) {
    const col = PAPER[KINDS[cells[i]!]!];
    const px = gx + (i % CELLS);
    const py = gy + Math.floor(i / CELLS);
    const n = (hash(px, py) - 0.5) * 10;
    out[i * 4] = col[0] + n;
    out[i * 4 + 1] = col[1] + n;
    out[i * 4 + 2] = col[2] + n * 0.8;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 2× box downsample of a square RGBA block (`side` px → `side / 2`). */
export function halve(src: Uint8ClampedArray, side: number): Uint8ClampedArray {
  const h = side >> 1;
  const out = new Uint8ClampedArray(h * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      for (let c = 0; c < 4; c++) {
        const a = (2 * y * side + 2 * x) * 4 + c;
        const b = a + side * 4;
        out[(y * h + x) * 4 + c] = (src[a]! + src[a + 4]! + src[b]! + src[b + 4]! + 2) >> 2;
      }
    }
  }
  return out;
}

/** Atlas level for a screen scale `k` (px / m): the coarsest that is still ≥ the screen. */
export function levelFor(k: number): number {
  let l = 0;
  while (l + 1 < LEVELS && CELLS / (1 << (l + 1)) / FOG_CHUNK_M >= k) l++;
  return l;
}

interface Tile {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** CPU copy of the tile (chunks are written here, uploaded in one `putImageData`). */
  img: ImageData;
  side: number;
  /** Pixel rectangle changed since the last upload, or undefined. */
  dirty: { x0: number; y0: number; x1: number; y1: number } | undefined;
}

export interface ChunkWindow {
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
}

/**
 * Tiled terrain atlas over the map's chunk bounds. `paint` a chunk once (from a loaded chunk or
 * one fetched for a discovered chunk); `draw` blits the visible tiles of the right level.
 */
export class OverviewAtlas {
  private readonly levels: Map<number, Tile>[] = Array.from(
    { length: LEVELS },
    () => new Map<number, Tile>(),
  );
  private readonly painted: Uint8Array;
  private readonly requested: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Bumps on every painted chunk. */
  version = 0;
  paintedCount = 0;
  private missing: number[] = [];
  private missingFor = -1;

  constructor(
    readonly bounds: ChunkWindow,
    private readonly palette: readonly (string | null)[],
  ) {
    this.width = bounds.cx1 - bounds.cx0 + 1;
    this.height = bounds.cy1 - bounds.cy0 + 1;
    this.painted = new Uint8Array(this.width * this.height);
    this.requested = new Uint8Array(this.width * this.height);
  }

  private idx(cx: number, cy: number): number {
    const x = cx - this.bounds.cx0;
    const y = cy - this.bounds.cy0;
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? -1 : y * this.width + x;
  }

  has(cx: number, cy: number): boolean {
    const i = this.idx(cx, cy);
    return i >= 0 && this.painted[i] === 1;
  }

  private tile(level: number, tx: number, ty: number): Tile | undefined {
    const m = this.levels[level]!;
    const key = ty * 4096 + tx;
    let t = m.get(key);
    if (!t) {
      const side = (TILE_CHUNKS * CELLS) >> level;
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      t = { canvas, ctx, img: new ImageData(side, side), side, dirty: undefined };
      m.set(key, t);
    }
    return t;
  }

  /** Paints chunk (cx, cy) from its ground floor; false when outside the bounds. */
  paint(cx: number, cy: number, data: Pick<ChunkData, 'floor' | 'room' | 'roof'>): boolean {
    const i = this.idx(cx, cy);
    if (i < 0) return false;
    const lx = cx - this.bounds.cx0;
    const ly = cy - this.bounds.cy0;
    let rgba = cellsToRgba(chunkCells(data, this.palette), lx * CELLS, ly * CELLS);
    let side = CELLS;
    for (let l = 0; l < LEVELS; l++) {
      const t = this.tile(l, Math.floor(lx / TILE_CHUNKS), Math.floor(ly / TILE_CHUNKS));
      if (t) {
        const x0 = (lx % TILE_CHUNKS) * side;
        const y0 = (ly % TILE_CHUNKS) * side;
        for (let y = 0; y < side; y++) {
          t.img.data.set(
            rgba.subarray(y * side * 4, (y + 1) * side * 4),
            ((y0 + y) * t.side + x0) * 4,
          );
        }
        const d = t.dirty;
        t.dirty = d
          ? {
              x0: Math.min(d.x0, x0),
              y0: Math.min(d.y0, y0),
              x1: Math.max(d.x1, x0 + side),
              y1: Math.max(d.y1, y0 + side),
            }
          : { x0, y0, x1: x0 + side, y1: y0 + side };
      }
      if (l + 1 < LEVELS) {
        rgba = halve(rgba, side);
        side >>= 1;
      }
    }
    if (this.painted[i] !== 1) this.paintedCount++;
    this.painted[i] = 1;
    this.version++;
    return true;
  }

  /**
   * Paints the loaded chunks in `win` that are not painted yet (`get` = the synchronous view of
   * the loaded chunks, ground floor). Returns how many were painted.
   */
  pump(win: ChunkWindow, get: (cx: number, cy: number) => ChunkData | undefined, budget = 64) {
    let n = 0;
    const b = this.bounds;
    for (let cy = Math.max(win.cy0, b.cy0); cy <= Math.min(win.cy1, b.cy1); cy++) {
      for (let cx = Math.max(win.cx0, b.cx0); cx <= Math.min(win.cx1, b.cx1); cx++) {
        if (this.has(cx, cy)) continue;
        const d = get(cx, cy);
        if (d && this.paint(cx, cy, d) && ++n >= budget) return n;
      }
    }
    return n;
  }

  /**
   * Up to `max` discovered chunks that are neither painted nor requested yet (marked requested),
   * nearest to (px, py) first, to be fetched by the caller (e.g. after loading a save). The
   * candidate list is rebuilt once per `fogVersion`.
   */
  nextMissing(
    fog: FogGrid,
    fogVersion: number,
    px: number,
    py: number,
    max: number,
  ): { cx: number; cy: number }[] {
    if (fogVersion !== this.missingFor) {
      this.missingFor = fogVersion;
      const list: { i: number; d: number }[] = [];
      for (let y = 0; y < fog.height; y++) {
        for (let x = 0; x < fog.width; x++) {
          const fi = y * fog.width + x;
          if (((fog.bits[fi >> 3] ?? 0) & (1 << (fi & 7))) === 0) continue;
          const i = this.idx(fog.cx0 + x, fog.cy0 + y);
          if (i < 0 || this.painted[i] || this.requested[i]) continue;
          const dx = (fog.cx0 + x + 0.5) * FOG_CHUNK_M - px;
          const dy = (fog.cy0 + y + 0.5) * FOG_CHUNK_M - py;
          list.push({ i, d: dx * dx + dy * dy });
        }
      }
      // Farthest first in the array: `pop` gives the nearest.
      list.sort((a, b) => b.d - a.d);
      this.missing = list.map((e) => e.i);
    }
    const out: { cx: number; cy: number }[] = [];
    while (out.length < max && this.missing.length > 0) {
      const i = this.missing.pop()!;
      if (this.painted[i] || this.requested[i]) continue;
      this.requested[i] = 1;
      out.push({
        cx: this.bounds.cx0 + (i % this.width),
        cy: this.bounds.cy0 + Math.floor(i / this.width),
      });
    }
    return out;
  }

  /** Lets a failed fetch be tried again later. */
  unrequest(cx: number, cy: number): void {
    const i = this.idx(cx, cy);
    if (i >= 0) {
      this.requested[i] = 0;
      this.missingFor = -1;
    }
  }

  /** Draws the visible atlas tiles for `view` (level by zoom; nothing where unpainted). */
  draw(ctx: CanvasRenderingContext2D, view: View, vp: Viewport, k: number): number {
    const level = levelFor(k);
    const tileM = TILE_CHUNKS * FOG_CHUNK_M;
    const ox = this.bounds.cx0 * FOG_CHUNK_M;
    const oy = this.bounds.cy0 * FOG_CHUNK_M;
    const wx0 = view.center.x - vp.width / 2 / k;
    const wy0 = view.center.y - vp.height / 2 / k;
    const wx1 = view.center.x + vp.width / 2 / k;
    const wy1 = view.center.y + vp.height / 2 / k;
    ctx.imageSmoothingEnabled = true;
    let drawn = 0;
    for (const [key, t] of this.levels[level]!) {
      const tx = key % 4096;
      const ty = Math.floor(key / 4096);
      const x0 = ox + tx * tileM;
      const y0 = oy + ty * tileM;
      if (x0 > wx1 || y0 > wy1 || x0 + tileM < wx0 || y0 + tileM < wy0) continue;
      if (t.dirty) {
        const d = t.dirty;
        t.ctx.putImageData(t.img, 0, 0, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
        t.dirty = undefined;
      }
      const sx = vp.width / 2 + (x0 - view.center.x) * k;
      const sy = vp.height / 2 + (y0 - view.center.y) * k;
      // Snap to whole px so neighbouring tiles do not leave hairline seams.
      const x = Math.floor(sx);
      const y = Math.floor(sy);
      const w = Math.ceil(sx + tileM * k) - x;
      const h = Math.ceil(sy + tileM * k) - y;
      ctx.drawImage(t.canvas, 0, 0, t.side, t.side, x, y, w, h);
      drawn++;
    }
    return drawn;
  }
}

/** Fogged paper (`#5C5344`, fog-render.ts) for the far-zoom mask. */
export const FOG_MASK_RGB = [92, 83, 68] as const;

/**
 * Fog of the far zooms: 1 px per chunk, fog colour where undiscovered, transparent where
 * discovered; drawn scaled up with smoothing (soft, 1-chunk edge). Rebuilt when the discovery
 * bitmap changes (a 704 × 704 world is ~2 ms).
 */
export class FogMask {
  readonly canvas = document.createElement('canvas');
  private version = -1;
  private img: ImageData | undefined;

  update(fog: FogGrid, version: number): boolean {
    if (version === this.version && this.img) return false;
    this.version = version;
    if (this.canvas.width !== fog.width || this.canvas.height !== fog.height || !this.img) {
      this.canvas.width = fog.width;
      this.canvas.height = fog.height;
      this.img = new ImageData(fog.width, fog.height);
      const d = this.img.data;
      for (let i = 0; i < fog.width * fog.height; i++) {
        d[i * 4] = FOG_MASK_RGB[0];
        d[i * 4 + 1] = FOG_MASK_RGB[1];
        d[i * 4 + 2] = FOG_MASK_RGB[2];
      }
    }
    fogMaskAlpha(fog, this.img.data);
    this.canvas.getContext('2d')?.putImageData(this.img, 0, 0);
    return true;
  }

  /** Draws the mask over the fog grid's world rectangle. */
  draw(ctx: CanvasRenderingContext2D, fog: FogGrid, view: View, vp: Viewport, k: number): void {
    const x = vp.width / 2 + (fog.cx0 * FOG_CHUNK_M - view.center.x) * k;
    const y = vp.height / 2 + (fog.cy0 * FOG_CHUNK_M - view.center.y) * k;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, x, y, fog.width * FOG_CHUNK_M * k, fog.height * FOG_CHUNK_M * k);
  }
}

/** Alpha channel of the fog mask: 0 discovered, 255 fog (pure; tests). */
export function fogMaskAlpha(fog: FogGrid, rgba: Uint8ClampedArray): void {
  const n = fog.width * fog.height;
  for (let i = 0; i < n; i++) {
    rgba[i * 4 + 3] = ((fog.bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0 ? 0 : 255;
  }
}
