import type { IRail, PlanIndex } from './plan-index.js';
import {
  CROSSING_HALF,
  crossingScale,
  crossingSides,
  onRoad,
  underRoadDeck,
} from './rail-crossing.js';
import { onCarriageway, syntheticCrossings } from './level-crossings.js';

/**
 * Infrastructure of a chunk from the plan (Designer's `assets-src/infra`, attach points in
 * `<model>.attach.json`, `@deadzone/content/wires`): power line towers / poles with the spans
 * between them, railway track (1 m tiles along every rail), switches, buffer stops, level
 * crossings and catenary masts with their spans on electrified lines. World metres; an item
 * belongs to the chunk holding its position (a span: the chunk of its first pole). Render only.
 */
export interface GenPole {
  /** Model id (file name without `.glb`). */
  m: string;
  x: number;
  y: number;
  /** Yaw (three.js `rotation.y`): model +z along `(sin rot, cos rot)` in world (x, y). */
  rot: number;
  /** Mirrored in x (left-hand switch). */
  mirror?: 1;
  /** Model z scale (level crossing stretched over a wide road); omitted = 1. */
  len?: number;
  /** Level crossing furniture sides (bit 1 = model −x, bit 2 = +x); omitted = both. */
  furn?: 0 | 1 | 2;
}

/** Wires between two poles: every attach id present on both, sag as a fraction of the span. */
export interface GenSpan {
  a: GenPole;
  b: GenPole;
  sag: number;
}

export interface GenInfra {
  poles: GenPole[];
  spans: GenSpan[];
  /** Track tiles: x, y, rot, length (≈ 1 m: a rail is cut into whole tiles), flat. */
  track: number[];
  /** Feet of towers / catenary masts reaching into the chunk (`SimChunk.blockers`, local m). */
  blockers?: { x0: number; y0: number; x1: number; y1: number }[];
}

/** Sag of high / low voltage spans and of the catenary messenger (fraction of the span). */
export const HV_SAG = 0.035;
export const LV_SAG = 0.025;
export const MW_SAG = 0.018;
/** Catenary mast spacing (m, 50–60) and the track axis offset of a mast (model x = +3.2). */
export const MAST_SPACING = 55;
export const MAST_TRACK_X = 3.2;
/** Low voltage poles at most this far apart (m): longer OSM segments get poles in between. */
export const LV_MAX_SPAN = 45;

export const HV_MODEL = {
  hv110: ['hv110-os24', 'hv110-dt'],
  hv220: ['hv220', 'hv220'],
  hv400: ['hv400-portal', 'hv400-portal'],
} as const;

type V = { x: number; y: number };
const norm = (x: number, y: number): V => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};
/** Yaw that turns model +z onto direction d. */
export const yawOf = (d: V) => Math.atan2(d.x, d.y);
/** World direction of model +x at yaw `rot`. */
export const sideOf = (rot: number): V => ({ x: Math.cos(rot), y: -Math.sin(rot) });
const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`;

function points(pts: Float64Array): V[] {
  const out: V[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push({ x: pts[i]!, y: pts[i + 1]! });
  return out;
}

/** Distance from p to a polyline. */
function distToLine(p: V, pts: Float64Array): number {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k]!;
    const ay = pts[k + 1]!;
    const dx = pts[k + 2]! - ax;
    const dy = pts[k + 3]! - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + t * dx - p.x, ay + t * dy - p.y));
  }
  return best;
}

/** Point and unit direction at arc length s along a polyline (cumulative lengths `cum`). */
function at(p: V[], cum: number[], s: number): { pt: V; d: V } {
  let k = 1;
  while (k < p.length - 1 && cum[k]! < s) k++;
  const a = p[k - 1]!;
  const b = p[k]!;
  const seg = cum[k]! - cum[k - 1]! || 1;
  const t = Math.max(0, Math.min(1, (s - cum[k - 1]!) / seg));
  return {
    pt: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    d: norm(b.x - a.x, b.y - a.y),
  };
}

function cumulative(p: V[]): number[] {
  const cum = [0];
  for (let k = 1; k < p.length; k++)
    cum.push(cum[k - 1]! + Math.hypot(p[k]!.x - p[k - 1]!.x, p[k]!.y - p[k - 1]!.y));
  return cum;
}

/** Clearance (m) of a pole / tower centre from roads, sidewalks and buildings. */
export const POLE_CLEAR = { lv: 0.6, hv: 4 } as const;
/** How far (m) a blocked pole may move along its line, then sideways, before it is dropped. */
export const POLE_SHIFT_ALONG = 12;
export const POLE_SHIFT_SIDE = 12;

function inRings(x: number, y: number, rings: readonly Float64Array[]): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 2; i + 1 < r.length; j = i, i += 2) {
      const yi = r[i + 1]!;
      const yj = r[j + 1]!;
      if (yi > y !== yj > y && x < ((r[j]! - r[i]!) * (y - yi)) / (yj - yi) + r[i]!)
        inside = !inside;
    }
  return inside;
}

/**
 * True when a pole at p stands clear of every carriageway, sidewalk / footway (zebras are on the
 * carriageway) and building, with `clear` metres to spare.
 */
export function poleSpotFree(idx: PlanIndex, p: V, clear: number): boolean {
  const q = { x0: p.x - 1, y0: p.y - 1, x1: p.x + 1, y1: p.y + 1 };
  for (const i of idx.roads.query(q)) {
    const r = idx.roads.items[i]!;
    if (r.bridge) continue;
    if (distToLine(p, r.pts) < Math.max(r.r, r.rs) + clear) return false;
  }
  for (const i of idx.buildings.query(q)) {
    const b = idx.buildings.items[i]!;
    if (inRings(p.x, p.y, b.rings)) return false;
  }
  return true;
}

/**
 * Nearest free spot for a pole at arc length s of a line: first along the line (keeps the wires
 * straight), then sideways onto the verge; undefined = drop the pole.
 */
function freeSpot(idx: PlanIndex, p: V[], cum: number[], s: number, clear: number) {
  const L = cum[cum.length - 1]!;
  for (let k = 0; k <= POLE_SHIFT_ALONG; k++)
    for (const sg of k ? [1, -1] : [1]) {
      const t = s + sg * k;
      if (t < 0 || t > L) continue;
      const a = at(p, cum, t);
      if (poleSpotFree(idx, a.pt, clear)) return a.pt;
    }
  const a = at(p, cum, s);
  for (let k = 1; k <= POLE_SHIFT_SIDE; k++)
    for (const sg of [1, -1]) {
      const pt = { x: a.pt.x - a.d.y * sg * k, y: a.pt.y + a.d.x * sg * k };
      if (poleSpotFree(idx, pt, clear)) return pt;
    }
  return undefined;
}

/** An oriented rectangle where no plain track tile goes (switch, buffer stop, crossing). */
interface Hole {
  c: V;
  d: V;
  hu: number;
  hv: number;
}
const inHole = (h: Hole, p: V) => {
  const u = (p.x - h.c.x) * h.d.x + (p.y - h.c.y) * h.d.y;
  const v = -(p.x - h.c.x) * h.d.y + (p.y - h.c.y) * h.d.x;
  return Math.abs(u) < h.hu && Math.abs(v) < h.hv;
};

/** Infrastructure of chunk (cx, cy) (chunk edge `C`), undefined when there is none. */
export function chunkInfra(
  idx: PlanIndex,
  cx: number,
  cy: number,
  C: number,
): GenInfra | undefined {
  const X0 = cx * C;
  const Y0 = cy * C;
  const inChunk = (p: V) => p.x >= X0 && p.x < X0 + C && p.y >= Y0 && p.y < Y0 + C;
  /** Segment a–b crosses the chunk (a span goes to every chunk under it; the game dedupes). */
  const crosses = (a: V, b: V) => {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    for (const [p, qq] of [
      [-dx, a.x - X0],
      [dx, X0 + C - a.x],
      [-dy, a.y - Y0],
      [dy, Y0 + C - a.y],
    ] as const) {
      if (p === 0) {
        if (qq < 0) return false;
        continue;
      }
      const r = qq / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
    return true;
  };
  const poles: GenPole[] = [];
  const spans: GenSpan[] = [];
  /** Towers / masts whose feet may reach into the chunk (sim blockers), deduped by position. */
  const footed = new Map<string, GenPole>();
  const nearChunk = (p: V) =>
    p.x >= X0 - FOOT_REACH &&
    p.x < X0 + C + FOOT_REACH &&
    p.y >= Y0 - FOOT_REACH &&
    p.y < Y0 + C + FOOT_REACH;
  const foot = (p: GenPole) => {
    if (FOOT[p.m] && nearChunk(p)) footed.set(key(p.x, p.y), p);
  };
  const track: number[] = [];
  const M = 80;
  const q = { x0: X0 - M, y0: Y0 - M, x1: X0 + C + M, y1: Y0 + C + M };

  // ---- power lines: a tower / pole on every vertex (low voltage: also in long spans) ----------
  const placed = new Set<string>();
  for (const i of idx.power.query(q)) {
    const w = idx.power.items[i]!;
    let p = points(w.pts);
    if (p.length < 2) continue;
    if (w.kind === 'lv') {
      const dense: V[] = [p[0]!];
      for (let k = 1; k < p.length; k++) {
        const a = p[k - 1]!;
        const b = p[k]!;
        const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / LV_MAX_SPAN);
        for (let j = 1; j < n; j++)
          dense.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
        dense.push(b);
      }
      p = dense;
    }
    // Poles off carriageways, sidewalks and buildings: slide along the line, else to the verge,
    // else drop (the wire then spans the gap). OSM puts many street lines on the road axis.
    {
      const cum = cumulative(p);
      const clear = w.kind === 'lv' ? POLE_CLEAR.lv : POLE_CLEAR.hv;
      const moved: V[] = [];
      p.forEach((_, k) => {
        const f = freeSpot(idx, p, cum, cum[k]!, clear);
        const last = moved[moved.length - 1];
        if (f && (!last || Math.hypot(f.x - last.x, f.y - last.y) > 3)) moved.push(f);
      });
      p = moved;
      if (p.length < 2) continue;
    }
    const list: GenPole[] = p.map((pt, k) => {
      const din = k > 0 ? norm(pt.x - p[k - 1]!.x, pt.y - p[k - 1]!.y) : undefined;
      const dout = k < p.length - 1 ? norm(p[k + 1]!.x - pt.x, p[k + 1]!.y - pt.y) : undefined;
      const b = din && dout ? norm(din.x + dout.x, din.y + dout.y) : (din ?? dout)!;
      let rot = yawOf(b.x === 0 && b.y === 0 ? (dout ?? din)! : b);
      let m: string;
      if (w.kind === 'lv') {
        const turn =
          din && dout ? Math.acos(Math.max(-1, Math.min(1, din.x * dout.x + din.y * dout.y))) : 0;
        if (turn > (25 * Math.PI) / 180) {
          m = 'lv-zerdz-narozny';
          // Corner pole on the bisector, its +x (stay arm) to the outside of the turn.
          const out = norm(din!.x - dout!.x, din!.y - dout!.y);
          const sx = sideOf(rot);
          if (sx.x * out.x + sx.y * out.y < 0) rot += Math.PI;
        } else m = k % 3 === 1 ? 'lv-zerdz-latarnia' : 'lv-zerdz';
      } else m = HV_MODEL[w.kind][w.circuits === 2 ? 1 : 0];
      return {
        m,
        x: Math.round(pt.x * 100) / 100,
        y: Math.round(pt.y * 100) / 100,
        rot: Math.round(rot * 1e4) / 1e4,
      };
    });
    list.forEach((pole, k) => {
      const next = list[k + 1];
      if (next && crosses(pole, next))
        spans.push({ a: pole, b: next, sag: w.kind === 'lv' ? LV_SAG : HV_SAG });
      foot(pole);
      if (!inChunk(pole)) return;
      const kk = key(pole.x, pole.y);
      // Lines split into several ways share the tower at the joint: one model.
      if (!placed.has(kk)) {
        placed.add(kk);
        poles.push(pole);
      }
    });
  }

  // ---- railway -------------------------------------------------------------------------------
  const rails = idx.rails.query(q).map((i) => idx.rails.items[i]!);
  if (rails.length) {
    // Vertex use count over the rails in reach (track ends = vertices used once, at an end).
    const uses = new Map<string, number>();
    for (const r of rails)
      for (let k = 0; k + 1 < r.pts.length; k += 2) {
        const kk = key(r.pts[k]!, r.pts[k + 1]!);
        uses.set(kk, (uses.get(kk) ?? 0) + 1);
      }
    const holes: Hole[] = [];
    // Directions away from a node along every rail through it.
    const arms = (n: V): V[] => {
      const out: V[] = [];
      for (const r of rails) {
        for (let k = 0; k + 1 < r.pts.length; k += 2) {
          if (Math.abs(r.pts[k]! - n.x) > 0.06 || Math.abs(r.pts[k + 1]! - n.y) > 0.06) continue;
          if (k >= 2) out.push(norm(r.pts[k - 2]! - n.x, r.pts[k - 1]! - n.y));
          if (k + 3 < r.pts.length) out.push(norm(r.pts[k + 2]! - n.x, r.pts[k + 3]! - n.y));
        }
      }
      return out;
    };
    const ends = new Set<string>();
    const synth = syntheticCrossings(idx, q);
    const crossings: V[] = idx.railNodes
      .query(q)
      .map((i) => idx.railNodes.items[i]!)
      .filter((n) => n.kind === 'level_crossing' && onCarriageway(idx, n))
      .map((n): V => n)
      .concat(synth);
    const crossing = (n: V, d: V) => {
      const len = crossingScale(idx, n, d);
      holes.push({ c: n, d, hu: CROSSING_HALF * len, hv: 2.4 });
      if (inChunk(n)) {
        const rot = Math.round(yawOf(d) * 1e4) / 1e4;
        const others = crossings.filter((o) => o !== n);
        const furn = crossingSides(n, d, sideOf(rot), others, len);
        poles.push({
          m: 'przejazd-kat-a',
          x: n.x,
          y: n.y,
          rot,
          ...(len !== 1 ? { len } : {}),
          ...(furn !== 3 ? { furn } : {}),
        });
      }
    };
    for (const i of idx.railNodes.query(q)) {
      const n = idx.railNodes.items[i]!;
      const a = arms(n);
      if (n.kind === 'switch') {
        if (a.length < 3) continue;
        // Main line: the most opposite pair of arms; the branch: the arm nearest to one of them.
        let best = 2;
        let mi = 0;
        let mj = 1;
        for (let x = 0; x < a.length; x++)
          for (let y = x + 1; y < a.length; y++) {
            const d = a[x]!.x * a[y]!.x + a[x]!.y * a[y]!.y;
            if (d < best) {
              best = d;
              mi = x;
              mj = y;
            }
          }
        const rest = a.filter((_, k) => k !== mi && k !== mj);
        const br = rest[0]!;
        const f =
          a[mi]!.x * br.x + a[mi]!.y * br.y > a[mj]!.x * br.x + a[mj]!.y * br.y ? a[mi]! : a[mj]!;
        const rot = yawOf(f);
        const sx = sideOf(rot);
        const c = { x: n.x + f.x * 13.5, y: n.y + f.y * 13.5 };
        holes.push({ c, d: f, hu: 13.5, hv: 1.6 });
        if (inChunk(c))
          poles.push({
            m: 'tor-rozjazd-1-9',
            x: Math.round(c.x * 100) / 100,
            y: Math.round(c.y * 100) / 100,
            rot: Math.round(rot * 1e4) / 1e4,
            ...(sx.x * br.x + sx.y * br.y < 0 ? { mirror: 1 as const } : {}),
          });
      } else if (n.kind === 'buffer_stop') {
        if (a.length !== 1) continue; // only a real end of a track
        ends.add(key(n.x, n.y));
      } else if (n.kind === 'level_crossing') {
        if (a.length < 1 || !onCarriageway(idx, n)) continue;
        const f = a[0]!;
        crossing(n, { x: -f.x, y: -f.y });
      }
    }
    for (const s of synth) crossing(s, s.d);
    // Sidings ending in nothing: buffer stops too (main lines run off the map instead).
    for (const r of rails) {
      if (!r.siding || r.pts.length < 4) continue;
      const L = r.pts.length;
      for (const [ex, ey] of [
        [r.pts[0]!, r.pts[1]!],
        [r.pts[L - 2]!, r.pts[L - 1]!],
      ] as const) {
        if ((uses.get(key(ex, ey)) ?? 0) === 1) ends.add(key(ex, ey));
      }
    }
    for (const r of rails) {
      const L = r.pts.length;
      if (L < 4) continue;
      for (const [ex, ey, px, py] of [
        [r.pts[0]!, r.pts[1]!, r.pts[2]!, r.pts[3]!],
        [r.pts[L - 2]!, r.pts[L - 1]!, r.pts[L - 4]!, r.pts[L - 3]!],
      ] as const) {
        if (!ends.has(key(ex, ey)) || (uses.get(key(ex, ey)) ?? 0) !== 1) continue;
        const d = norm(ex - px, ey - py);
        const c = { x: ex - d.x * 3, y: ey - d.y * 3 };
        holes.push({ c, d, hu: 3, hv: 1.6 });
        if (inChunk(c))
          poles.push({
            m: 'tor-koziol-oporowy',
            x: Math.round(c.x * 100) / 100,
            y: Math.round(c.y * 100) / 100,
            rot: Math.round(yawOf(d) * 1e4) / 1e4,
          });
      }
    }
    // Track: whole tiles along every rail (continuous over bridges and joints).
    for (const r of rails) {
      const p = points(r.pts);
      if (p.length < 2) continue;
      const cum = cumulative(p);
      for (let k = 1; k < p.length; k++) {
        const a = p[k - 1]!;
        const b = p[k]!;
        if (
          Math.max(a.x, b.x) < X0 - 2 ||
          Math.min(a.x, b.x) > X0 + C + 2 ||
          Math.max(a.y, b.y) < Y0 - 2 ||
          Math.min(a.y, b.y) > Y0 + C + 2
        )
          continue;
        const len = cum[k]! - cum[k - 1]!;
        const n = Math.max(1, Math.round(len));
        const step = len / n;
        const d = norm(b.x - a.x, b.y - a.y);
        const rot = Math.round(yawOf(d) * 1e4) / 1e4;
        for (let j = 0; j < n; j++) {
          const c = { x: a.x + d.x * (j + 0.5) * step, y: a.y + d.y * (j + 0.5) * step };
          if (!inChunk(c) || holes.some((h) => inHole(h, c))) continue;
          // Under a road viaduct the track runs below the deck: not drawn over it.
          if (!r.bridge && underRoadDeck(idx, c)) continue;
          track.push(
            Math.round(c.x * 100) / 100,
            Math.round(c.y * 100) / 100,
            rot,
            Math.round(step * 1000) / 1000,
          );
        }
      }
    }
    // Catenary: masts every ~55 m on one side of an electrified track, wires mast to mast.
    const masts = new Set<string>();
    for (const r of rails) {
      if (!r.el) continue;
      const p = points(r.pts);
      if (p.length < 2) continue;
      const cum = cumulative(p);
      const total = cum[cum.length - 1]!;
      const n = Math.max(1, Math.round(total / MAST_SPACING));
      const spacing = total / n;
      let prev: GenPole | undefined;
      let prevK = -2;
      for (let k = 0; k <= n; k++) {
        const s = k * spacing;
        const { pt, d } = at(p, cum, s);
        // Only masts near this chunk matter (their spans may come in from a neighbour).
        if (
          pt.x < X0 - MAST_SPACING * 1.5 ||
          pt.x > X0 + C + MAST_SPACING * 1.5 ||
          pt.y < Y0 - MAST_SPACING * 1.5 ||
          pt.y > Y0 + C + MAST_SPACING * 1.5
        ) {
          prev = undefined;
          continue;
        }
        const mast = mastAt(
          idx,
          pt,
          d,
          k % 2 === 0 ? 'catenary-mast-a' : 'catenary-mast-b',
          rails,
          r,
        );
        if (!mast) {
          prev = undefined;
          continue;
        }
        foot(mast);
        if (inChunk(mast)) {
          const kk = key(pt.x, pt.y);
          if (!masts.has(kk)) {
            masts.add(kk);
            poles.push(mast);
          }
        }
        if (prev && prevK === k - 1 && crosses(prev, mast))
          spans.push({ a: prev, b: mast, sag: MW_SAG });
        prev = mast;
        prevK = k;
      }
    }
  }
  // A pad on the track bed (within the track model's half width of a rail axis) is dropped.
  const onTrack = (x: number, y: number, e: number) =>
    rails.some((r) => distToLine({ x, y }, r.pts) < TRACK_HALF + e);
  const blockers = [...footed.values()].flatMap((p) => footBlockers(p, X0, Y0, C, onTrack));
  if (!poles.length && !spans.length && !track.length && !blockers.length) return undefined;
  return { poles, spans, track, ...(blockers.length ? { blockers } : {}) };
}

/**
 * Feet of towers and catenary masts (model space, metres): pads `[x, z, half]` (square, half
 * size). Lattice towers stand on 4 legs at the corners of their base (the gap between legs stays
 * walkable); a mast is one base plate. Level-crossing barriers and low-voltage poles: none.
 */
export const FOOT: Record<string, readonly (readonly [number, number, number])[]> = (() => {
  const legs = (hx: number, hz: number, h = 0.45): (readonly [number, number, number])[] => [
    [-hx + h, -hz + h, h],
    [hx - h, -hz + h, h],
    [-hx + h, hz - h, h],
    [hx - h, hz - h, h],
  ];
  return {
    'hv110-os24': legs(2.85, 2.85),
    'hv110-dt': legs(2.3, 2.3),
    hv220: legs(3.05, 3.05),
    'hv400-portal': legs(8.35, 2.35),
    'catenary-mast-a': [[0, 0, 0.65]],
    'catenary-mast-b': [[0, 0, 0.65]],
  };
})();
/** Farthest foot from a tower centre (m): towers this far outside the chunk may reach in. */
const FOOT_REACH = 10;
/** Half width of the track model (sleepers, ballast; `tor-kafel-1m`), metres. */
export const TRACK_HALF = 2.3;

/**
 * Sim blockers (`SimChunk.blockers`, chunk-local metres) of one tower / mast: each foot pad
 * rotated with the model, its axis-aligned box, clipped to the chunk (empty pieces dropped).
 */
export function footBlockers(
  p: GenPole,
  X0: number,
  Y0: number,
  C: number,
  /** Pad at world (x, y) with half extent e is on something walkable-only (dropped). */
  skip?: (x: number, y: number, e: number) => boolean,
): { x0: number; y0: number; x1: number; y1: number }[] {
  const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  for (const [fx0, fz, h] of FOOT[p.m] ?? []) {
    const fx = p.mirror ? -fx0 : fx0;
    // Model +x → (cos, −sin), +z → (sin, cos) in world (x, y).
    const wx = p.x + fx * c + fz * s;
    const wy = p.y - fx * s + fz * c;
    const e = h * (Math.abs(c) + Math.abs(s));
    if (skip?.(wx, wy, h)) continue;
    const r = (v: number) => Math.round(v * 100) / 100;
    const x0 = r(Math.max(0, wx - e - X0));
    const y0 = r(Math.max(0, wy - e - Y0));
    const x1 = r(Math.min(C, wx + e - X0));
    const y1 = r(Math.min(C, wy + e - Y0));
    if (x1 - x0 > 0.01 && y1 - y0 > 0.01) out.push({ x0, y0, x1, y1 });
  }
  return out;
}

/** A catenary mast beside the track at pt (direction d): the side clear of other tracks. */
function mastAt(
  idx: PlanIndex,
  pt: V,
  d: V,
  m: string,
  rails: readonly IRail[],
  own: IRail,
): GenPole | undefined {
  for (const flip of [0, Math.PI]) {
    const rot = yawOf(d) + flip;
    const sx = sideOf(rot);
    // Track axis at model x = +3.2: the mast stands 3.2 m to the other side.
    const pos = { x: pt.x - sx.x * MAST_TRACK_X, y: pt.y - sx.y * MAST_TRACK_X };
    const clear =
      rails.every((r) => r === own || distToLine(pos, r.pts) > 2.6) && !onRoad(idx, pos, 0.5);
    if (clear)
      return {
        m,
        x: Math.round(pos.x * 100) / 100,
        y: Math.round(pos.y * 100) / 100,
        rot: Math.round(rot * 1e4) / 1e4,
      };
  }
  return undefined;
}
