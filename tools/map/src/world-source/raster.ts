import { clearUnderDeck } from './under-deck.js';
import type { AreaKind } from '../osm/types.js';
import {
  G_ASPHALT,
  G_CONCRETE,
  G_DIRT,
  G_GRASS,
  G_PARKING,
  G_RAIL,
  G_SIDEWALK,
  G_WATER,
} from './palette.js';
import type { PlanIndex } from './plan-index.js';

/** Ground of an area kind (raster class) and its tree class (1 = woods, 2 = park trees). */
const AREA_GROUND: Partial<Record<AreaKind, number>> = {
  farmland: G_DIRT,
  sand: G_DIRT,
  construction: G_DIRT,
  industrial: G_CONCRETE,
  commercial: G_CONCRETE,
  fuel: G_CONCRETE,
  paved: G_SIDEWALK,
  parking: G_PARKING,
  railway: G_DIRT,
  military: G_DIRT,
  water: G_WATER,
};
export const AREA_TREES: Partial<Record<AreaKind, number>> = {
  forest: 1,
  scrub: 1,
  park: 2,
  cemetery: 2,
  orchard: 2,
};

export const ROAD_GROUND = (k: string): number =>
  k === 'path' || k === 'track'
    ? G_DIRT
    : k === 'footway' || k === 'cycleway' || k === 'steps'
      ? G_SIDEWALK
      : G_ASPHALT;

/** Ground layers of a tile window (window-independent: each tile only depends on the plan). */
export interface Raster {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Ground class (GROUND_TILES index). */
  g: Uint8Array;
  /** Tree class: 1 woods, 2 park / cemetery / orchard. */
  tree: Uint8Array;
  rail: Uint8Array;
  /** Bridge deck (roads / rails over rails or water), drawn at level 0. */
  deck: Uint8Array;
  /** Area kind rank under the tile (+1; 0 = none) — chunk kinds. */
  area: Uint8Array;
  /**
   * Ground class before the roads / paved areas were painted, +1 (0 = no road or paved area on
   * the tile): the renderer draws it under the smooth vector roads and paved-area polygons instead
   * of the stair-stepped tiles.
   */
  under: Uint8Array;
}

export function inRaster(r: Raster, x: number, y: number): boolean {
  return x >= r.x0 && y >= r.y0 && x < r.x0 + r.w && y < r.y0 + r.h;
}
export const rIndex = (r: Raster, x: number, y: number): number => (y - r.y0) * r.w + (x - r.x0);

/** Scanline fill of rings (tile centres inside, even-odd), clipped to the window. */
export function fillRings(
  rings: readonly Float64Array[],
  x0: number,
  y0: number,
  w: number,
  h: number,
  set: (i: number) => void,
): void {
  let ry0 = Infinity;
  let ry1 = -Infinity;
  for (const r of rings)
    for (let i = 1; i < r.length; i += 2) {
      ry0 = Math.min(ry0, r[i]!);
      ry1 = Math.max(ry1, r[i]!);
    }
  const ya = Math.max(y0, Math.floor(ry0));
  const yb = Math.min(y0 + h - 1, Math.ceil(ry1));
  const xs: number[] = [];
  for (let y = ya; y <= yb; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (const r of rings) {
      const n = r.length >> 1;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = r[2 * i + 1]!;
        const yj = r[2 * j + 1]!;
        if (yi > yc !== yj > yc) {
          const xi = r[2 * i]!;
          const xj = r[2 * j]!;
          xs.push(xi + ((yc - yi) * (xj - xi)) / (yj - yi));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(x0, Math.ceil(xs[k]! - 0.5));
      const xb = Math.min(x0 + w - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = xa; x <= xb; x++) set((y - y0) * w + (x - x0));
    }
  }
}

/**
 * Conservative fill: only tiles whose whole square lies inside the rings (centre inside and no
 * ring edge crosses the square). The tile stair-steps of a slanted outline then always stay on
 * the inner side of the line (vector walls are drawn on the line itself).
 */
export function fillRingsInner(
  rings: readonly Float64Array[],
  x0: number,
  y0: number,
  w: number,
  h: number,
  set: (i: number) => void,
): void {
  const inside = new Uint8Array(w * h);
  fillRings(rings, x0, y0, w, h, (i) => (inside[i] = 1));
  const E = 1e-7;
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = r[2 * j]!;
      const ay = r[2 * j + 1]!;
      const bx = r[2 * i]!;
      const by = r[2 * i + 1]!;
      const tx0 = Math.max(x0, Math.floor(Math.min(ax, bx)));
      const tx1 = Math.min(x0 + w - 1, Math.floor(Math.max(ax, bx)));
      const ty0 = Math.max(y0, Math.floor(Math.min(ay, by)));
      const ty1 = Math.min(y0 + h - 1, Math.floor(Math.max(ay, by)));
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          const k = (ty - y0) * w + (tx - x0);
          if (
            inside[k] &&
            segmentCrossesBox(ax, ay, bx, by, tx + E, ty + E, tx + 1 - E, ty + 1 - E)
          )
            inside[k] = 0;
        }
    }
  }
  for (let i = 0; i < inside.length; i++) if (inside[i]) set(i);
}

/** Whether segment a–b meets the open box (Liang–Barsky clip). */
export function segmentCrossesBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  return clipSegment(ax, ay, bx, by, x0, y0, x1, y1) !== undefined;
}

/** Part of segment a–b inside the box [x0, x1] × [y0, y1] (Liang–Barsky), or undefined. */
export function clipSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number, number] | undefined {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let k = 0; k < 4; k++) {
    if (p[k] === 0) {
      if (q[k]! < 0) return undefined;
      continue;
    }
    const t = q[k]! / p[k]!;
    if (p[k]! < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return undefined;
  }
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

/** Tiles whose centre lies within `r` of the polyline, clipped to the window. */
export function stroke(
  pts: Float64Array,
  r: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  set: (i: number) => void,
): void {
  const r2 = r * r;
  for (let k = 2; k + 1 < pts.length; k += 2) {
    const ax = pts[k - 2]!;
    const ay = pts[k - 1]!;
    const bx = pts[k]!;
    const by = pts[k + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const ya = Math.max(y0, Math.floor(Math.min(ay, by) - r));
    const yb = Math.min(y0 + h - 1, Math.ceil(Math.max(ay, by) + r));
    const xa = Math.max(x0, Math.floor(Math.min(ax, bx) - r));
    const xb = Math.min(x0 + w - 1, Math.ceil(Math.max(ax, bx) + r));
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
        const ex = px - dx * t;
        const ey = py - dy * t;
        if (ex * ex + ey * ey <= r2) set((y - y0) * w + (x - x0));
      }
  }
}

/**
 * Ground of the window [x0, x0 + w) × [y0, y0 + h): land cover, areas (paint order), waterways,
 * rails, roads with sidewalks, bridge decks. Same rules as the OSM scene (`osm/scene.ts`), plus
 * water. Pure: a tile's value never depends on the window.
 */
export function rasterGround(idx: PlanIndex, x0: number, y0: number, w: number, h: number): Raster {
  const n = w * h;
  const g = new Uint8Array(n).fill(G_GRASS);
  const tree = new Uint8Array(n);
  const rail = new Uint8Array(n);
  const deck = new Uint8Array(n);
  const area = new Uint8Array(n);
  const under = new Uint8Array(n);
  const q = { x0, y0, x1: x0 + w, y1: y0 + h };
  const cover = idx.plan.landCover;
  if (cover) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = cover(x0 + x + 0.5, y0 + y + 0.5);
        if (!k) continue;
        const i = y * w + x;
        g[i] = AREA_GROUND[k] ?? G_GRASS;
        tree[i] = AREA_TREES[k] ?? 0;
      }
  }
  for (const i of idx.areas.query(q)) {
    const a = idx.areas.items[i]!;
    const gi = AREA_GROUND[a.kind] ?? G_GRASS;
    const tr = AREA_TREES[a.kind] ?? 0;
    const paved = a.kind === 'paved';
    fillRings(a.rings, x0, y0, w, h, (j) => {
      // Paved areas (plazas, area:highway) are drawn as smooth polygons over the ground they
      // cover (`GenColumn.paved`); an area painted later over them shows as its own tiles.
      if (paved) {
        if (!under[j]) under[j] = g[j]! + 1;
      } else under[j] = 0;
      g[j] = gi;
      tree[j] = tr;
      area[j] = a.rank + 1;
    });
  }
  for (const i of idx.waters.query(q)) {
    const wt = idx.waters.items[i]!;
    stroke(wt.pts, wt.r, x0, y0, w, h, (j) => {
      g[j] = G_WATER;
      tree[j] = 0;
      under[j] = 0;
    });
  }
  const roads = idx.roads.query(q);
  const rails = idx.rails.query(q);
  for (const i of rails) {
    const r = idx.rails.items[i]!;
    if (r.bridge) continue;
    stroke(r.pts, 1.9, x0, y0, w, h, (j) => {
      g[j] = G_RAIL;
      rail[j] = 1;
      tree[j] = 0;
    });
  }
  const keep = (j: number) => {
    if (!under[j]) under[j] = g[j]! + 1;
  };
  const paint = (bridge: boolean) => {
    for (const i of roads) {
      const r = idx.roads.items[i]!;
      if (r.bridge !== bridge) continue;
      if (r.rs > 0) {
        stroke(r.pts, r.rs, x0, y0, w, h, (j) => {
          keep(j);
          if (g[j] !== G_ASPHALT && g[j] !== G_RAIL) g[j] = G_SIDEWALK;
          tree[j] = 0;
          if (bridge) deck[j] = 1;
        });
      }
      const t = ROAD_GROUND(r.kind);
      stroke(r.pts, r.r, x0, y0, w, h, (j) => {
        // Footpaths do not cut the carriageway (crossings stay asphalt).
        if (t !== G_ASPHALT && g[j] === G_ASPHALT) return;
        keep(j);
        g[j] = t;
        tree[j] = 0;
        if (bridge) deck[j] = 1;
      });
    }
  };
  paint(false);
  paint(true);
  for (const i of rails) {
    const r = idx.rails.items[i]!;
    if (!r.bridge) continue;
    stroke(r.pts, 1.9, x0, y0, w, h, (j) => {
      g[j] = G_RAIL;
      deck[j] = 1;
      tree[j] = 0;
    });
  }
  clearUnderDeck(w, h, rail, deck, under);
  return { x0, y0, w, h, g, tree, rail, deck, area, under };
}
