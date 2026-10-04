import { segDist, type Pt } from './geom.js';
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
  | 'hedge';

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
  'seed' | 'size' | 'river' | 'riverWidth' | 'settlements' | 'forestThreshold'
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

/** Precomputed lookups for fast per-point land cover. */
export class GroundField {
  private readonly riverCell = 256;
  private readonly riverCells = new Map<number, number[]>();
  constructor(readonly plan: GroundPlan) {
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
    let nearTown = false;
    for (const s of p.settlements) {
      const pad = s.kind === 'village' ? s.r * 1.8 + 120 : s.r + 260;
      if (Math.hypot(x - s.x, y - s.y) < pad) nearTown = true;
    }
    const f = forestNoise(p.seed, x, y, p.size);
    if (!nearTown && f > p.forestThreshold && rd > 70) return 'forest';
    if (rd < 220) return valueNoise(p.seed + 5, x / 90, y / 90) < 0.6 ? 'meadow' : 'pasture';
    if (f > p.forestThreshold - 0.03 && !nearTown) return 'meadow';
    return this.field(x, y);
  }

  /** Field patchwork: regions (jittered Voronoi, 1.4 km) of parallel strips with crops. */
  private field(x: number, y: number): Ground {
    const seed = this.plan.seed;
    const { id: rid, ang } = fieldRegion(seed, x, y);
    const W = 30 + ((rid >>> 9) % 90); // strip width (Polish fields are narrow)
    const L = 160 + ((rid >>> 17) % 300);
    const u = x * Math.cos(ang) + y * Math.sin(ang);
    const v = -x * Math.sin(ang) + y * Math.cos(ang);
    const cu = Math.floor(u / W);
    const cv = Math.floor(v / L);
    const ph = hash3(seed + 13, cu, cv ^ (rid & 0xfff));
    const fu = u / W - cu;
    const fv = v / L - cv;
    // Hedgerows / balks on some parcel borders.
    if (ph % 7 === 0 && (fu < 3 / W || fv < 3 / L)) return 'hedge';
    return CROPS[ph % CROPS.length] ?? 'meadow';
  }
}
