import { meander, type Pt } from './geom.js';
import { fbm, hash3, rng } from './rng.js';

/**
 * Terrain of the world plan (metres above the river mouth): broad hills and basins plus a tilt
 * down toward the river's mouth, so water runs the way the land falls. The river is traced
 * downhill over it (`traceRiver`), lakes sit in its basins. Pure: (seed, size) only.
 */
export function baseHeight(seed: number, size: number, x: number, y: number, mouth: Pt): number {
  const tilt = (Math.hypot(x - mouth.x, y - mouth.y) / size) * 34;
  let hills = 0;
  for (const h of hillsOf(seed, size)) {
    const d2 = ((x - h.x) ** 2 + (y - h.y) ** 2) / (h.r * h.r);
    if (d2 < 9) hills += h.h * Math.exp(-d2 * 1.6);
  }
  return (
    46 * fbm(seed + 41, x / 5200, y / 5200, 4) +
    9 * fbm(seed + 43, x / 1300, y / 1300, 3) +
    tilt +
    hills
  );
}

/** A named hill (wzgórze): a bump on the terrain, peak height `h` m over its surroundings. */
export interface Hill {
  x: number;
  y: number;
  /** Radius (m) of the slope. */
  r: number;
  h: number;
  name: string;
}

const HILL_NAMES = [
  'Łysa Góra',
  'Kamienna Góra',
  'Wapienna Góra',
  'Gołębia Góra',
  'Krzyżowa Góra',
  'Wzgórze Zamkowe',
  'Lisia Góra',
  'Dębowa Góra',
  'Wietrzna Góra',
  'Kozia Góra',
  'Sowia Góra',
  'Wzgórze Trzech Krzyży',
];
const hillCache = new Map<string, Hill[]>();

/** Hills of the map, 1 per ~22 km² (pure: seed and size), at least 1.8 km apart. */
export function hillsOf(seed: number, size: number): Hill[] {
  const key = `${seed}:${size}`;
  const hit = hillCache.get(key);
  if (hit) return hit;
  const r = rng(hash3(seed, 0x4111, 7));
  const want = Math.max(4, Math.round((size / 1000) ** 2 / 22));
  const out: Hill[] = [];
  for (let k = 0; k < want * 20 && out.length < want; k++) {
    const x = size * (0.08 + r() * 0.84);
    const y = size * (0.08 + r() * 0.84);
    if (out.some((h) => Math.hypot(h.x - x, h.y - y) < 1800)) continue;
    out.push({
      x,
      y,
      r: 450 + r() * 650,
      h: 16 + r() * 22,
      name: HILL_NAMES[out.length % HILL_NAMES.length] as string,
    });
  }
  hillCache.set(key, out);
  return out;
}

/**
 * A tributary or stream from `start` down the terrain to the first water it meets (`wet`), with
 * a pull toward `goal` growing as it goes so it always arrives. Undefined if it wanders off the
 * map or hits `blocked` (settlements, the base) first. Meandered like the river.
 */
export function traceStream(
  seed: number,
  size: number,
  mouth: Pt,
  start: Pt,
  goal: (p: Pt) => Pt,
  wet: (p: Pt) => boolean,
  blocked: (p: Pt) => boolean,
  rand: () => number,
  step = 60,
): Pt[] | undefined {
  const h = (x: number, y: number) => baseHeight(seed, size, x, y, mouth);
  const walk: Pt[] = [{ ...start }];
  let p = { ...start };
  let g = goal(p);
  let dir = Math.atan2(g.y - p.y, g.x - p.x);
  const maxSteps = Math.ceil((size * 1.5) / step);
  for (let k = 0; k < maxSteps; k++) {
    g = goal(p);
    const toGoal = Math.atan2(g.y - p.y, g.x - p.x);
    const pull = 0.05 + (k / maxSteps) ** 2 * 10;
    let best = dir;
    let bestCost = Infinity;
    for (const t of TURNS) {
      const d = dir + t;
      const q = { x: p.x + Math.cos(d) * step * 6, y: p.y + Math.sin(d) * step * 6 };
      const off = Math.atan2(Math.sin(d - toGoal), Math.cos(d - toGoal));
      let cost = h(q.x, q.y) + pull * off * off * 6;
      for (let j = 0; j < walk.length - 10; j += 3) {
        const w = walk[j] as Pt;
        const dd = Math.hypot(q.x - w.x, q.y - w.y);
        if (dd < 400) cost += (400 - dd) * 0.2;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = d;
      }
    }
    dir = best;
    p = { x: p.x + Math.cos(dir) * step, y: p.y + Math.sin(dir) * step };
    if (p.x < 0 || p.y < 0 || p.x > size || p.y > size) return undefined;
    if (blocked(p)) return undefined;
    walk.push({ ...p });
    if (wet(p)) break;
    if (k === maxSteps - 1) return undefined;
  }
  if (walk.length < 6) return undefined;
  const pts: Pt[] = [walk[0] as Pt];
  for (let k = 4; k < walk.length + 3; k += 4) {
    const a = walk[k - 4] as Pt;
    const b = walk[Math.min(k, walk.length - 1)] as Pt;
    pts.push(...meander(a, b, 0.12, 30, rand).slice(1));
    if (k >= walk.length - 1) break;
  }
  return pts;
}

/** Where the river enters (north edge) and leaves (east or south edge) the map. */
export function riverEnds(size: number, rand: () => number): { source: Pt; mouth: Pt } {
  const source = { x: size * (0.15 + rand() * 0.35), y: -60 };
  const mouth =
    rand() < 0.5
      ? { x: size + 60, y: size * (0.55 + rand() * 0.3) }
      : { x: size * (0.6 + rand() * 0.3), y: size + 60 };
  return { source, mouth };
}

const STEP = 70;
/** Candidate turns per step (rad): the river may bend at most this much every STEP metres. */
const TURNS = [-0.5, -0.33, -0.17, 0, 0.17, 0.33, 0.5];

/**
 * River centre line from the north edge to the mouth: a greedy walk downhill (lowest terrain a
 * step ahead, with a pull toward the mouth growing with distance walked so it always arrives),
 * then meanders added on the walked line. Returns the polyline and its terrain profile.
 */
export function traceRiver(
  seed: number,
  size: number,
  rand: () => number,
): { pts: Pt[]; source: Pt; mouth: Pt } {
  const { source, mouth } = riverEnds(size, rand);
  const h = (x: number, y: number) => baseHeight(seed, size, x, y, mouth);
  const walk: Pt[] = [{ ...source }];
  let p = { x: source.x, y: 0 };
  walk.push({ ...p });
  let dir = Math.atan2(mouth.y - p.y, mouth.x - p.x);
  const maxSteps = Math.ceil((size * 3) / STEP);
  for (let k = 0; k < maxSteps; k++) {
    const toMouth = Math.atan2(mouth.y - p.y, mouth.x - p.x);
    const pull = 0.02 + (k / maxSteps) ** 2 * 8;
    let best = dir;
    let bestCost = Infinity;
    for (const t of TURNS) {
      const d = dir + t;
      const q = { x: p.x + Math.cos(d) * STEP * 8, y: p.y + Math.sin(d) * STEP * 8 };
      const off = Math.atan2(Math.sin(d - toMouth), Math.cos(d - toMouth));
      let cost = h(q.x, q.y) + pull * off * off * 6;
      // Keep off the map edges (but the mouth's) and away from its own earlier course.
      const edge = Math.min(q.x, q.y, size - q.x, size - q.y);
      if (edge < 600 && Math.hypot(q.x - mouth.x, q.y - mouth.y) > 1500 && k > 4)
        cost += (600 - edge) * 0.2;
      for (let j = 0; j < walk.length - 12; j += 3) {
        const w = walk[j] as Pt;
        const dd = Math.hypot(q.x - w.x, q.y - w.y);
        if (dd < 700) cost += (700 - dd) * 0.2;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = d;
      }
    }
    dir = best;
    p = { x: p.x + Math.cos(dir) * STEP, y: p.y + Math.sin(dir) * STEP };
    walk.push({ ...p });
    if (p.x < -40 || p.y < -40 || p.x > size + 40 || p.y > size + 40) break;
  }
  // Meanders: midpoint displacement between every 4th walked point.
  const pts: Pt[] = [walk[0] as Pt];
  for (let k = 4; k < walk.length + 3; k += 4) {
    const a = walk[k - 4] as Pt;
    const b = walk[Math.min(k, walk.length - 1)] as Pt;
    pts.push(...meander(a, b, 0.14, 45, rand).slice(1));
    if (k >= walk.length - 1) break;
  }
  return { pts, source, mouth };
}
