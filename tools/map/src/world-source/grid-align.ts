import type { OsmBuilding, OsmMap } from '../osm/types.js';
import { PlanIndex } from './plan-index.js';
import type { WorldPlanInput } from './plan.js';
import { fillRings, stroke } from './raster.js';
import {
  OSM_ROTATION_DEG,
  SQUARE_TOLERANCE_DEG,
  ringOrientation,
  rotation,
  straightenOsmMap,
  unrotatePt,
} from './straighten.js';

/**
 * Buildings off the street grid turned onto it (no zigzag walls on the tile grid). After the
 * global rotation and squaring (`straighten.ts`) a building that still lies at an angle is turned
 * as a whole about its centre onto the axes, as long as it does not newly cover a road, rail,
 * water or another building; failing that it is shrunk slightly (≥ 85 %) and / or shifted a few
 * metres inside its own plot (the bounding box of its original footprint). If nothing fits it
 * keeps its angle (squared to its own axis, zigzag on the grid). Pure: a function of the whole map
 * (buildings in file order; each decision sees the earlier ones' final outlines), so it runs once
 * when the tiles are written (`cli-tiles.ts`), not per tile. Returns raw-frame rings.
 */

export interface GridAlignStats {
  /** Squared buildings lying off the grid before the pass. */
  offGrid: number;
  /** Turned onto the grid at full size in place. */
  turned: number;
  /** Turned, but shifted and / or shrunk to fit. */
  fitted: number;
  /** Left at an angle (collision whatever the fit): zigzag on the grid. */
  jagged: number;
  /** Off the grid but not rectilinear (round / odd outlines; never turned). */
  irregular: number;
}

/** Scales tried (whole size first), shifts (tiles) within the plot. */
const SCALES = [1, 0.95, 0.9, 0.85];
const SHIFT = 3;
const SHIFTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let dy = -SHIFT; dy <= SHIFT; dy++)
    for (let dx = -SHIFT; dx <= SHIFT; dx++) out.push([dx, dy]);
  return out.sort(
    (a, b) =>
      Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])) ||
      a[1] - b[1] ||
      a[0] - b[0],
  );
})();

type Rings = Float64Array[];

const dmToTiles = (r: readonly number[]): Float64Array => Float64Array.from(r, (v) => v / 10);

function bbox(rings: Rings): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings)
    for (let i = 0; i + 1 < r.length; i += 2) {
      x0 = Math.min(x0, r[i]!);
      y0 = Math.min(y0, r[i + 1]!);
      x1 = Math.max(x1, r[i]!);
      y1 = Math.max(y1, r[i + 1]!);
    }
  return { x0, y0, x1, y1 };
}

/** Rings turned by −deg about c, scaled by s about c, shifted, snapped to whole tiles. */
function flatten(
  rings: Rings,
  deg: number,
  c: { x: number; y: number },
  s: number,
  dx: number,
  dy: number,
): Rings {
  const a = (-deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return rings.map((r) => {
    const out = new Float64Array(r.length);
    for (let i = 0; i + 1 < r.length; i += 2) {
      const px = r[i]! - c.x;
      const py = r[i + 1]! - c.y;
      out[i] = Math.round(c.x + (px * cos - py * sin) * s + dx);
      out[i + 1] = Math.round(c.y + (px * sin + py * cos) * s + dy);
    }
    return out;
  });
}

export function alignBuildingsToGrid(
  map: OsmMap,
  deg = OSM_ROTATION_DEG,
  stats?: GridAlignStats,
): OsmMap {
  const st = straightenOsmMap(map, deg);
  const idx = new PlanIndex({ features: st } as unknown as WorldPlanInput);
  const rot = rotation(deg);
  const indexOf = new Map<OsmBuilding, number>(st.buildings.map((b, i) => [b, i]));
  /** Final world-frame outline (tiles) of every building decided so far. */
  const current: Rings[] = st.buildings.map((b) => b.rings.map(dmToTiles));
  const out: OsmBuilding[] = [...map.buildings];
  const s: GridAlignStats = { offGrid: 0, turned: 0, fitted: 0, jagged: 0, irregular: 0 };
  st.buildings.forEach((b, i) => {
    const rings = current[i]!;
    const outer = rings[0];
    if (!outer || outer.length < 10) return;
    const o = ringOrientation(Array.from(outer));
    if (Math.abs(o.deg) <= SQUARE_TOLERANCE_DEG) return;
    if (o.share < 0.98) {
      s.irregular++;
      return;
    }
    s.offGrid++;
    const bb = bbox(rings);
    const P = 6;
    const x0 = Math.floor(bb.x0) - P;
    const y0 = Math.floor(bb.y0) - P;
    const w = Math.ceil(bb.x1) + P - x0;
    const h = Math.ceil(bb.y1) + P - y0;
    const n = w * h;
    const own = new Uint8Array(n);
    let ownN = 0;
    fillRings(rings, x0, y0, w, h, (j) => {
      own[j] = 1;
      ownN++;
    });
    if (!ownN) return;
    // Plot: bounding box of the original footprint (tiles).
    let px0 = w;
    let py0 = h;
    let px1 = -1;
    let py1 = -1;
    for (let j = 0; j < n; j++) {
      if (!own[j]) continue;
      const x = j % w;
      const y = (j - x) / w;
      px0 = Math.min(px0, x);
      py0 = Math.min(py0, y);
      px1 = Math.max(px1, x);
      py1 = Math.max(py1, y);
    }
    const blocked = new Uint8Array(n);
    const q = { x0, y0, x1: x0 + w, y1: y0 + h };
    for (const k of idx.roads.query(q)) {
      const r = idx.roads.items[k]!;
      stroke(r.pts, Math.max(r.r, r.rs), x0, y0, w, h, (j) => (blocked[j] = 1));
    }
    for (const k of idx.rails.query(q))
      stroke(idx.rails.items[k]!.pts, 1.9, x0, y0, w, h, (j) => (blocked[j] = 1));
    for (const k of idx.waters.query(q)) {
      const wt = idx.waters.items[k]!;
      stroke(wt.pts, wt.r, x0, y0, w, h, (j) => (blocked[j] = 1));
    }
    for (const k of idx.buildings.query(q)) {
      const j0 = indexOf.get(idx.buildings.items[k]!.b);
      if (j0 === undefined || j0 === i) continue;
      fillRings(current[j0]!, x0, y0, w, h, (j) => (blocked[j] = 1));
    }
    const c = { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 };
    let found: Rings | undefined;
    let fitted = false;
    for (const sc of SCALES) {
      for (const [dx, dy] of SHIFTS) {
        const cand = flatten(rings, o.deg, c, sc, dx, dy);
        let ok = true;
        let cnt = 0;
        fillRings(cand, x0, y0, w, h, (j) => {
          if (!ok) return;
          cnt++;
          const x = j % w;
          const y = (j - x) / w;
          if (x < px0 || x > px1 || y < py0 || y > py1 || (blocked[j] && !own[j])) ok = false;
        });
        if (!ok || cnt < ownN * 0.7) continue;
        found = cand;
        fitted = sc !== 1 || dx !== 0 || dy !== 0;
        break;
      }
      if (found) break;
    }
    if (!found) {
      s.jagged++;
      return;
    }
    if (fitted) s.fitted++;
    else s.turned++;
    current[i] = found;
    out[i] = {
      ...map.buildings[i]!,
      rings: found.map((r) => {
        const raw: number[] = [];
        for (let k = 0; k + 1 < r.length; k += 2) {
          const p = unrotatePt(rot, r[k]!, r[k + 1]!);
          raw.push(Math.round(p.x * 10), Math.round(p.y * 10));
        }
        return raw;
      }),
    };
  });
  if (stats) Object.assign(stats, s);
  return { ...map, buildings: out };
}
