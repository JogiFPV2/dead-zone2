import { dist, meander, type ORect, type Pt } from './geom.js';
import { hash3, rng, valueNoise } from './rng.js';

/**
 * Old town (stare miasto) of a city / town: the medieval core the 19th-century grid grew
 * around. Irregular on purpose:
 * - a market square (rynek) slightly off-centre and off the grid angle,
 * - crooked streets leaving its corners and sides, out to a ring road on the line of the old
 *   walls (a noisy loop, not a circle) and an inner lane loop between them,
 * - narrow tenements packed along every street frontage, each turned to its street,
 * - town hall on the square, the parish church at a corner of it.
 * The grid skips everything inside the ring; short streets join the grid's cut ends to it.
 * Pure: depends only on (seed, settlement id, centre, radius, angle).
 */
export interface OldTownInput {
  seed: number;
  id: number;
  x: number;
  y: number;
  /** Settlement built-up radius (m). */
  r: number;
  angle: number;
  city: boolean;
}

export interface OldTown {
  /** Ring radius at angle (world angle, rad) from the centre. */
  ringAt(ang: number): number;
  centre: Pt;
  /** Closed ring polygon (first point repeated at the end). */
  ring: Pt[];
  /** Inner lane loop (empty in small towns). */
  innerRing: Pt[];
  square: ORect;
  /** Streets from the square out to the ring. */
  radials: Pt[][];
  townHall: ORect;
  /** Church spots in order of preference; the last one is on the square (always free). */
  churchSpots: ORect[];
}

const RING_POINTS = 28;
/** Pavement between the street and the house fronts (m). */
const SIDEWALK = 1.5;

export function planOldTown(i: OldTownInput): OldTown {
  const rand = rng(hash3(i.seed, i.id, 0x01d));
  const R0 = i.r * (i.city ? 0.24 : 0.27);
  const ringAt = (ang: number, scale = 1, salt = 0): number =>
    R0 *
    scale *
    (0.8 +
      0.38 *
        valueNoise(
          i.seed + i.id * 13 + 777 + salt,
          5 + Math.cos(ang) * 1.3,
          5 + Math.sin(ang) * 1.3,
        ));
  const loop = (scale: number, salt: number): Pt[] => {
    const pts: Pt[] = [];
    for (let k = 0; k < RING_POINTS; k++) {
      const a = (k / RING_POINTS) * Math.PI * 2;
      const rr = ringAt(a, scale, salt) * (1 + (rand() - 0.5) * 0.06);
      pts.push({ x: i.x + Math.cos(a) * rr, y: i.y + Math.sin(a) * rr });
    }
    pts.push({ ...(pts[0] as Pt) });
    return pts;
  };
  const ring = loop(1, 0);
  // Small towns: no inner lane loop, fewer streets off the square (the lots need the room).
  const small = R0 < 95;
  const innerRing = small ? [] : loop(0.58, 31);
  // Market square: a little off-centre, turned off the grid.
  const off = R0 * 0.12;
  const oa = rand() * Math.PI * 2;
  const sw = (i.city ? 92 : 72) * (0.9 + rand() * 0.2);
  const sh = sw * (0.68 + rand() * 0.22);
  const square: ORect = {
    x: i.x + Math.cos(oa) * off,
    y: i.y + Math.sin(oa) * off,
    w: sw,
    h: sh,
    a: i.angle + (rand() - 0.5) * 0.45,
  };
  const c = Math.cos(square.a);
  const s = Math.sin(square.a);
  const at = (u: number, v: number): Pt => ({
    x: square.x + u * c - v * s,
    y: square.y + u * s + v * c,
  });
  // Streets from the 4 corners (diagonal-ish) and the middle of the 4 sides, crooked.
  const starts: { p: Pt; dir: number }[] = [];
  for (const [u, v] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const p = at((u * sw) / 2, (v * sh) / 2);
    starts.push({ p, dir: Math.atan2(p.y - square.y, p.x - square.x) + (rand() - 0.5) * 0.5 });
  }
  for (const [u, v] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (rand() < (small ? 0.65 : 0.25)) continue; // not every side has a street
    const p = at((u * sw) / 2, (v * sh) / 2);
    starts.push({ p, dir: Math.atan2(p.y - square.y, p.x - square.x) + (rand() - 0.5) * 0.3 });
  }
  const radials = starts.map(({ p, dir }) => {
    const rr = ringAt(dir) * 1.02;
    const end = { x: i.x + Math.cos(dir) * rr, y: i.y + Math.sin(dir) * rr };
    return meander(p, end, 0.06, 30, rand);
  });
  const townHall: ORect = {
    x: square.x,
    y: square.y,
    w: sw * 0.3,
    h: sh * 0.28,
    a: square.a,
  };
  // Parish church: just off the square (corners first, then the side middles); when every spot
  // is taken by streets, on the square itself, at one end (like Kraków's St Mary's).
  const ca = square.a + (rand() - 0.5) * 0.2;
  const churchSpots: ORect[] = [];
  const signs = rand() < 0.5 ? [1, -1] : [-1, 1];
  for (const cu of signs)
    for (const cv of signs) {
      const p = at(cu * (sw / 2 - 14), cv * (sh / 2 + 24));
      churchSpots.push({ x: p.x, y: p.y, w: 34, h: 15, a: ca });
    }
  for (const cu of signs) {
    const p = at(cu * (sw / 2 + 24), 0);
    churchSpots.push({ x: p.x, y: p.y, w: 34, h: 15, a: ca + Math.PI / 2 });
  }
  const inSq = at((signs[0] as number) * (sw / 2 - 12), 0);
  churchSpots.push({ x: inSq.x, y: inSq.y, w: 30, h: 14, a: square.a + Math.PI / 2 });
  return {
    ringAt: (ang) => ringAt(ang),
    centre: { x: i.x, y: i.y },
    ring,
    innerRing,
    square,
    radials,
    townHall,
    churchSpots,
  };
}

/** Square edges as a closed polyline (streets around the rynek). */
export function squareEdges(q: ORect): Pt[] {
  const c = Math.cos(q.a);
  const s = Math.sin(q.a);
  const at = (u: number, v: number): Pt => ({ x: q.x + u * c - v * s, y: q.y + u * s + v * c });
  const pts = [
    at(-q.w / 2, -q.h / 2),
    at(q.w / 2, -q.h / 2),
    at(q.w / 2, q.h / 2),
    at(-q.w / 2, q.h / 2),
  ];
  return [...pts, { ...(pts[0] as Pt) }];
}

/** Point where the segment centre → `p` (extended) meets the ring polygon, or undefined. */
export function ringHit(t: OldTown, p: Pt): Pt | undefined {
  const ang = Math.atan2(p.y - t.centre.y, p.x - t.centre.x);
  const rr = t.ringAt(ang);
  const d = dist(p, t.centre);
  if (d < rr) return undefined;
  // The ring polygon is jittered ±3 %: snap to its nearest vertex segment for a clean join.
  let best: Pt | undefined;
  let bd = Infinity;
  for (let k = 1; k < t.ring.length; k++) {
    const a = t.ring[k - 1] as Pt;
    const b = t.ring[k] as Pt;
    for (let s = 0; s <= 8; s++) {
      const q = { x: a.x + ((b.x - a.x) * s) / 8, y: a.y + ((b.y - a.y) * s) / 8 };
      const dd = dist(q, p);
      if (dd < bd) {
        bd = dd;
        best = q;
      }
    }
  }
  return best;
}

export interface Lot {
  x: number;
  y: number;
  w: number;
  h: number;
  a: number;
}

/** Usable frontage is cut back this far (m) from a polyline end (cross street, corner). */
const END_TRIM = 4;
/** Deepest tenement (m): sets how far a bend's inner corner is cut back. */
const MAX_DEPTH = 16;
/** Narrower lot widths (share of the slot) tried where a full lot is cut by a cross street. */
const CORNER_FRACTIONS = Array.from({ length: 14 }, (_, k) => 0.95 - k * 0.05);

/**
 * Tenement lots along both sides of a street, as unbroken frontages (pierzeje): every straight
 * segment of the polyline gets its own row, all lots turned to that segment's angle, their
 * widths (≈ 7–13 m) summing exactly to the segment's usable length, so neighbours touch wall to
 * wall with no gap and no overlap. Segment ends are trimmed at the polyline ends and at bends
 * (more on sharper turns), where the next segment's row takes over. Depth 11–16 m (shallower
 * when the deep one doesn't fit). `place`
 * accepts or rejects each lot (occupancy). Where a cross street cuts a slot, narrower corner
 * tenements fill it from both sides up to the cross street.
 */
export function frontage(
  street: readonly Pt[],
  roadWidth: number,
  rand: () => number,
  place: (lot: Lot) => boolean,
): number {
  let made = 0;
  // Crooked streets: straighten into runs first (within 1 m, inside the pavement), so each row
  // is long enough for a proper frontage.
  const pts = simplify(street, 1);
  const n = pts.length;
  const turnAt = (k: number): number => {
    // Turn angle at inner vertex k (0 at the polyline ends, or the closing vertex of a loop).
    const closed = n > 2 && dist(pts[0] as Pt, pts[n - 1] as Pt) < 1e-6;
    const prev = k === 0 ? (closed ? n - 2 : -1) : k - 1;
    const next = k === n - 1 ? (closed ? 1 : -1) : k + 1;
    if (prev < 0 || next < 0) return Number.NaN;
    const a = pts[prev] as Pt;
    const b = pts[k] as Pt;
    const c = pts[next] as Pt;
    const d0 = Math.atan2(b.y - a.y, b.x - a.x);
    const d1 = Math.atan2(c.y - b.y, c.x - b.x);
    return Math.atan2(Math.sin(d1 - d0), Math.cos(d1 - d0));
  };
  // Inside a bend the two rows would overlap: cut back by the depth's share of the turn. On the
  // outside they fan out: the fronts meet at the corner, nothing to cut.
  const trim = (k: number, side: number): number => {
    const t = turnAt(k);
    if (Number.isNaN(t)) return END_TRIM;
    if (Math.sign(t) !== side) return 0.5;
    return 0.5 + (roadWidth / 2 + SIDEWALK + MAX_DEPTH) * Math.tan(Math.min(Math.abs(t), 1.2) / 2);
  };
  for (let k = 1; k < n; k++) {
    const a = pts[k - 1] as Pt;
    const b = pts[k] as Pt;
    const L = dist(a, b);
    const dx = (b.x - a.x) / L;
    const dy = (b.y - a.y) / L;
    const ang = Math.atan2(dy, dx);
    for (const side of [-1, 1]) {
      const t0 = trim(k - 1, side);
      const U = L - t0 - trim(k, side);
      if (U < 5) continue;
      const count = Math.max(1, Math.ceil(U / 10));
      const weights = Array.from({ length: count }, () => 0.8 + rand() * 0.4);
      const sum = weights.reduce((x, y) => x + y, 0);
      let t = t0;
      for (const wt of weights) {
        const w = (U * wt) / sum;
        const d0 = 11 + rand() * 5;
        const nx = -dy * side;
        const ny = dx * side;
        // Shallower where the block behind is tight (same width: the row stays unbroken).
        const tryLot = (t0: number, lw: number): boolean => {
          const cx = a.x + dx * (t0 + lw / 2);
          const cy = a.y + dy * (t0 + lw / 2);
          for (const d of [d0, d0 * 0.7, 6]) {
            const o = roadWidth / 2 + SIDEWALK + d / 2;
            if (place({ x: cx + nx * o, y: cy + ny * o, w: lw, h: d, a: ang })) {
              made++;
              return true;
            }
          }
          return false;
        };
        if (!tryLot(t, w)) {
          // A cross street (or a corner building) cuts this lot: narrower corner tenements
          // (kamienice narożne) on either side of it, each against its neighbour in the row.
          let left = 0;
          for (const f of CORNER_FRACTIONS)
            if (w * f >= 4 && tryLot(t, w * f)) {
              left = w * f;
              break;
            }
          for (const f of CORNER_FRACTIONS) {
            // Never a sliver of a gap between the two pieces: closer than 1 m, they touch.
            const rw = w - left - w * f < 1 ? w - left : w * f;
            if (rw >= 4 && tryLot(t + w - rw, rw)) break;
          }
        }
        t += w;
      }
    }
  }
  return made;
}

/** Douglas–Peucker simplification of a polyline (keeps both ends). */
export function simplify(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 3) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop() as [number, number];
    const a = pts[i] as Pt;
    const b = pts[j] as Pt;
    let worst = -1;
    let wd = tol;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k] as Pt;
      const l = dist(a, b);
      const d =
        l < 1e-9 ? dist(p, a) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / l;
      if (d > wd) {
        wd = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}
