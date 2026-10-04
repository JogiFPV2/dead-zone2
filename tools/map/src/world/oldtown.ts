import { dist, meander, pointAt, polyLength, type ORect, type Pt } from './geom.js';
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

/**
 * Tenement lots along both sides of a street: narrow (7–13 m) frontage, 11–16 m deep, turned
 * to the street. `place` accepts or rejects each (occupancy), so lots fill the gaps only.
 */
export function frontage(
  pts: readonly Pt[],
  roadWidth: number,
  rand: () => number,
  place: (lot: Lot) => boolean,
): number {
  let made = 0;
  const L = polyLength(pts);
  for (const side of [-1, 1]) {
    for (let t = 4; t < L - 4;) {
      const w0 = 7 + rand() * 6;
      const dep = 11 + rand() * 5;
      // On bends and next to cross streets a narrower or shallower house still fits.
      let step = 3;
      for (const [fw, fd] of [
        [1, 1],
        [0.7, 1],
        [0.7, 0.7],
        [0.5, 0.7],
      ] as const) {
        const w = Math.max(5, w0 * fw);
        const d = dep * fd;
        const { p, dx, dy } = pointAt(pts, t + w / 2);
        const nx = -dy * side;
        const ny = dx * side;
        const o = roadWidth / 2 + SIDEWALK + d / 2;
        if (place({ x: p.x + nx * o, y: p.y + ny * o, w, h: d, a: Math.atan2(dy, dx) })) {
          made++;
          step = w + 0.1;
          break;
        }
      }
      t += step;
    }
  }
  return made;
}
