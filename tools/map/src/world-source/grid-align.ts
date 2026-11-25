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
  /** Off the grid but not rectilinear (round / odd outlines; turned only with `all`). */
  irregular: number;
  /** `all`: turned as part of a group of touching neighbours. */
  grouped?: number;
}

/** Scales tried (whole size first), shifts (tiles) within the plot. */
const SCALES = [1, 0.95, 0.9, 0.85];
const SHIFT = 3;
/** `all`: scales of the last pass (buildings that fit neither alone nor in a group). */
const LAST_SCALES = [0.8, 0.75, 0.7];
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

/** Options of `alignBuildingsToGrid`. */
export interface GridAlignOptions {
  /**
   * stw2 (Paweł 25.11: every building at one angle, as in Project Zomboid): odd outlines are turned
   * too (by their dominant direction), and buildings left at an angle after the single pass are
   * turned in groups (touching neighbours, e.g. terraced rows, as one block about its centre).
   */
  all?: boolean;
  /** Building ids left exactly as they are (e.g. ones cut by a fixed line in `landmarks.ts`). */
  keep?: ReadonlySet<number>;
}

export function alignBuildingsToGrid(
  map: OsmMap,
  deg = OSM_ROTATION_DEG,
  stats?: GridAlignStats,
  opts: GridAlignOptions = {},
): OsmMap {
  const st = straightenOsmMap(map, deg);
  const idx = new PlanIndex({ features: st } as unknown as WorldPlanInput);
  const rot = rotation(deg);
  const indexOf = new Map<OsmBuilding, number>(st.buildings.map((b, i) => [b, i]));
  /** Final world-frame outline (tiles) of every building decided so far. */
  const current: Rings[] = st.buildings.map((b) => b.rings.map(dmToTiles));
  const changed = new Set<number>();
  const s: GridAlignStats = { offGrid: 0, turned: 0, fitted: 0, jagged: 0, irregular: 0 };

  /**
   * Turn a unit (one building or a group) by −deg about its centre onto the axes, shrunk / shifted
   * within its plot when needed, so it covers no road, rail, water or other building.
   * Returns 'turned' | 'fitted' | undefined (nothing fits; outlines unchanged).
   */
  const place = (
    members: readonly number[],
    angle: number,
    scales: readonly number[] = SCALES,
    grow = 0,
  ): 'turned' | 'fitted' | undefined => {
    const rings = members.flatMap((i) => current[i]!);
    const bb = bbox(rings);
    const P = 6;
    const x0 = Math.floor(bb.x0) - P;
    const y0 = Math.floor(bb.y0) - P;
    const w = Math.ceil(bb.x1) + P - x0;
    const h = Math.ceil(bb.y1) + P - y0;
    const n = w * h;
    const own = new Uint8Array(n);
    let ownN = 0;
    for (const i of members)
      fillRings(current[i]!, x0, y0, w, h, (j) => {
        if (!own[j]) ownN++;
        own[j] = 1;
      });
    if (!ownN) return undefined;
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
    const mine = new Set(members);
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
      if (j0 === undefined || mine.has(j0)) continue;
      fillRings(current[j0]!, x0, y0, w, h, (j) => (blocked[j] = 1));
    }
    const c = { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 };
    for (const sc of scales) {
      for (const [dx, dy] of SHIFTS) {
        const cand = members.map((i) => flatten(current[i]!, angle, c, sc, dx, dy));
        let ok = true;
        let cnt = 0;
        const hit = (j: number) => {
          if (!ok) return;
          cnt++;
          const x = j % w;
          const y = (j - x) / w;
          if (
            x < px0 - grow ||
            x > px1 + grow ||
            y < py0 - grow ||
            y > py1 + grow ||
            (blocked[j] && !own[j])
          )
            ok = false;
        };
        for (const r of cand) if (ok) fillRings(r, x0, y0, w, h, hit);
        if (!ok || cnt < ownN * 0.7) continue;
        members.forEach((i, k) => {
          current[i] = cand[k]!;
          changed.add(i);
        });
        return sc !== 1 || dx !== 0 || dy !== 0 ? 'fitted' : 'turned';
      }
    }
    return undefined;
  };

  const left: number[] = [];
  st.buildings.forEach((b, i) => {
    if (opts.keep?.has(b.id)) return;
    const outer = current[i]![0];
    if (!outer || outer.length < 10) return;
    const o = ringOrientation(Array.from(outer));
    if (Math.abs(o.deg) <= SQUARE_TOLERANCE_DEG) return;
    if (o.share < 0.98) {
      s.irregular++;
      if (!opts.all) return;
    } else s.offGrid++;
    const r = place([i], o.deg);
    if (r) s[r]++;
    else {
      s.jagged++;
      left.push(i);
    }
  });

  // stw2: the buildings still at an angle, in groups of touching / near neighbours (≤ 1 m).
  const last: number[] = [];
  if (opts.all && left.length) {
    const parent = new Map<number, number>(left.map((i) => [i, i]));
    const find = (i: number): number => {
      let r = i;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(i, r);
      return r;
    };
    const boxes = new Map(left.map((i) => [i, bbox(current[i]!)]));
    for (const i of left) {
      const b = boxes.get(i)!;
      for (const k of idx.buildings.query({
        x0: b.x0 - 1,
        y0: b.y0 - 1,
        x1: b.x1 + 1,
        y1: b.y1 + 1,
      })) {
        const j = indexOf.get(idx.buildings.items[k]!.b);
        if (j === undefined || j === i || !parent.has(j)) continue;
        const a = find(i);
        const z = find(j);
        if (a !== z) parent.set(Math.max(a, z), Math.min(a, z));
      }
    }
    const groups = new Map<number, number[]>();
    for (const i of left) {
      const r = find(i);
      groups.set(r, [...(groups.get(r) ?? []), i]);
    }
    for (const members of groups.values()) {
      // Angle of the group: its largest member's.
      let big = members[0]!;
      let area = -1;
      for (const i of members) {
        const b = boxes.get(i)!;
        const a = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (a > area) {
          area = a;
          big = i;
        }
      }
      const o = ringOrientation(Array.from(current[big]![0]!));
      const r = place(members, o.deg);
      if (!r) {
        if (members.length > 1) for (const i of members) last.push(i);
        else last.push(members[0]!);
        continue;
      }
      s.jagged -= members.length;
      s.grouped = (s.grouped ?? 0) + members.length;
    }
    // Last resort: each one alone, allowed 3 m past its plot (a long thin building at 45° does
    // not fit its own bounding box) and shrunk further (down to 70 %); never onto a road / neighbour.
    for (const i of last) {
      const o = ringOrientation(Array.from(current[i]![0]!));
      if (!place([i], o.deg, [1, ...SCALES.slice(1), ...LAST_SCALES], 3)) continue;
      s.jagged--;
      s.grouped = (s.grouped ?? 0) + 1;
    }
  }

  const out: OsmBuilding[] = map.buildings.map((b, i) =>
    changed.has(i)
      ? {
          ...b,
          rings: current[i]!.map((r) => {
            const raw: number[] = [];
            for (let k = 0; k + 1 < r.length; k += 2) {
              const p = unrotatePt(rot, r[k]!, r[k + 1]!);
              raw.push(Math.round(p.x * 10), Math.round(p.y * 10));
            }
            return raw;
          }),
        }
      : b,
  );
  if (stats) Object.assign(stats, s);
  return { ...map, buildings: out };
}
