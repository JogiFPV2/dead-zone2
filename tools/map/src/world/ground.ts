import { PolylineIndex, segDist, type Pt } from './geom.js';
import { forestNoise, type WorldPlan } from './plan.js';
import { hash3, valueNoise } from './rng.js';

/** Base land cover under roads / buildings / areas. */
export type Ground =
  | 'water'
  | 'urban'
  | 'forest'
  | 'meadow'
  | 'pasture'
  | 'wheat'
  | 'rapeseed'
  | 'plowed'
  | 'corn'
  | 'fallow'
  | 'hedge'
  /** Flood meadows (łąki zalewowe) on the valley floors by the river and its tributaries. */
  | 'floodmeadow';

const CROPS: Ground[] = [
  'wheat',
  'wheat',
  'rapeseed',
  'plowed',
  'plowed',
  'corn',
  'fallow',
  'pasture',
  'meadow',
];

/** Farmland (fields, meadows, pastures, field hedges): open country with nothing on it yet. */
export const isFarmland = (g: Ground): boolean => g !== 'water' && g !== 'urban' && g !== 'forest';

/** What the land cover needs from a plan (it also runs on a plan still being built). */
export type GroundPlan = Pick<
  WorldPlan,
  'seed' | 'size' | 'river' | 'riverWidth' | 'settlements' | 'forestThreshold' | 'waterways'
>;

/** Field region at a point (jittered Voronoi, 1.4 km): its id hash and strip angle. */
export function fieldRegion(seed: number, x: number, y: number): { id: number; ang: number } {
  const R = 1400;
  const gx = Math.floor(x / R);
  const gy = Math.floor(y / R);
  let best = Infinity;
  let rid = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const h = hash3(seed + 11, gx + i, gy + j);
      const cx = (gx + i + ((h & 0xffff) / 65536) * 0.8 + 0.1) * R;
      const cy = (gy + j + ((h >>> 16) / 65536) * 0.8 + 0.1) * R;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < best) {
        best = d;
        rid = h;
      }
    }
  return { id: rid, ang: ((rid % 360) / 360) * Math.PI };
}

/** How a field region is cut: peasant strips, medium plots, or big state-farm (PGR) fields. */
export type FieldStyle = 'strips' | 'plots' | 'pgr';

/**
 * The field parcel at a point: its region's style, the parcel's width across / length along
 * the furrows, its id (crop) and the position inside it (0–1). Columns are staggered so the
 * parcels do not line up into a chessboard.
 */
export function fieldParcel(
  seed: number,
  x: number,
  y: number,
): { style: FieldStyle; w: number; l: number; id: number; fu: number; fv: number } {
  const { id: rid, ang } = fieldRegion(seed, x, y);
  const roll = rid % 10;
  const style: FieldStyle = roll < 5 ? 'strips' : roll < 8 ? 'plots' : 'pgr';
  const r1 = (rid >>> 9) % 1000;
  const r2 = (rid >>> 17) % 1000;
  const W =
    style === 'strips' ? 18 + (r1 % 28) : style === 'plots' ? 60 + (r1 % 80) : 250 + (r1 % 300);
  const L0 =
    style === 'strips' ? 150 + (r2 % 300) : style === 'plots' ? 120 + (r2 % 180) : 300 + (r2 % 350);
  const u = x * Math.cos(ang) + y * Math.sin(ang);
  const v = -x * Math.sin(ang) + y * Math.cos(ang);
  const cu = Math.floor(u / W);
  const hc = hash3(seed + 17, cu, rid & 0xffff);
  const L = L0 * (0.7 + ((hc % 1000) / 1000) * 0.6);
  const vv = v + ((hc >>> 10) % 1000) * 0.001 * L;
  const cv = Math.floor(vv / L);
  return {
    style,
    w: W,
    l: L,
    id: hash3(seed + 13, cu, cv ^ (rid & 0xfff)),
    fu: u / W - cu,
    fv: vv / L - cv,
  };
}

/** Precomputed lookups for fast per-point land cover. */
export class GroundField {
  private readonly riverCell = 256;
  private readonly riverCells = new Map<number, number[]>();
  private readonly ways: PolylineIndex[];
  constructor(readonly plan: GroundPlan) {
    this.ways = plan.waterways.map((w) => new PolylineIndex(w.pts));
    const r = plan.river;
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1] as Pt;
      const b = r[i] as Pt;
      const pad = 400;
      for (
        let y = Math.floor((Math.min(a.y, b.y) - pad) / this.riverCell);
        y <= Math.floor((Math.max(a.y, b.y) + pad) / this.riverCell);
        y++
      )
        for (
          let x = Math.floor((Math.min(a.x, b.x) - pad) / this.riverCell);
          x <= Math.floor((Math.max(a.x, b.x) + pad) / this.riverCell);
          x++
        ) {
          const k = y * 65536 + x;
          const l = this.riverCells.get(k);
          if (l) l.push(i);
          else this.riverCells.set(k, [i]);
        }
    }
  }

  /** Distance to the river centre line (Infinity when > ~400 m). */
  riverDist(x: number, y: number): number {
    const l = this.riverCells.get(
      Math.floor(y / this.riverCell) * 65536 + Math.floor(x / this.riverCell),
    );
    if (!l) return Infinity;
    let d = Infinity;
    for (const i of l) {
      const a = this.plan.river[i - 1] as Pt;
      const b = this.plan.river[i] as Pt;
      d = Math.min(d, segDist(x, y, a.x, a.y, b.x, b.y).d);
    }
    return d;
  }

  at(x: number, y: number): Ground {
    const p = this.plan;
    const rd = this.riverDist(x, y);
    const wobble = (valueNoise(p.seed + 3, x / 40, y / 40) - 0.5) * 6;
    if (rd < p.riverWidth / 2 + wobble) return 'water';
    // Tributaries and streams: water, and flood meadows along the tributaries.
    let wd = Infinity;
    let trib = Infinity;
    p.waterways.forEach((w, i) => {
      const d = (this.ways[i] as PolylineIndex).distNear(x, y) - w.width / 2;
      wd = Math.min(wd, d);
      if (w.kind === 'tributary') trib = Math.min(trib, d);
    });
    if (wd < wobble * 0.15) return 'water';
    let nearTown = false;
    for (const s of p.settlements) {
      const pad = s.kind === 'village' ? s.r * 1.8 + 120 : s.r + 260;
      if (Math.hypot(x - s.x, y - s.y) < pad) nearTown = true;
    }
    const f = forestNoise(p.seed, x, y, p.size);
    if (!nearTown && f > p.forestThreshold && rd > 70) return 'forest';
    if (rd < 220) {
      const n = valueNoise(p.seed + 5, x / 90, y / 90);
      return n < 0.45 ? 'floodmeadow' : n < 0.7 ? 'meadow' : 'pasture';
    }
    if (trib < 90 && !nearTown)
      return valueNoise(p.seed + 6, x / 70, y / 70) < 0.6 ? 'floodmeadow' : 'meadow';
    if (f > p.forestThreshold - 0.03 && !nearTown) return 'meadow';
    return this.field(x, y);
  }

  /** Field patchwork: regions (jittered Voronoi, 1.4 km) of crops (see `fieldParcel`). */
  private field(x: number, y: number): Ground {
    const q = fieldParcel(this.plan.seed, x, y);
    // Hedgerows / balks on some parcel borders.
    if (q.id % 7 === 0 && (q.fu * q.w < 3 || q.fv * q.l < 3)) return 'hedge';
    return CROPS[q.id % CROPS.length] ?? 'meadow';
  }
}
