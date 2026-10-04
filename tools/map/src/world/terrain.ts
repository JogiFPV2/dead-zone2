import { meander, type Pt } from './geom.js';
import { fbm } from './rng.js';

/**
 * Terrain of the world plan (metres above the river mouth): broad hills and basins plus a tilt
 * down toward the river's mouth, so water runs the way the land falls. The river is traced
 * downhill over it (`traceRiver`), lakes sit in its basins. Pure: (seed, size) only.
 */
export function baseHeight(seed: number, size: number, x: number, y: number, mouth: Pt): number {
  const tilt = (Math.hypot(x - mouth.x, y - mouth.y) / size) * 34;
  return (
    46 * fbm(seed + 41, x / 5200, y / 5200, 4) + 9 * fbm(seed + 43, x / 1300, y / 1300, 3) + tilt
  );
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
