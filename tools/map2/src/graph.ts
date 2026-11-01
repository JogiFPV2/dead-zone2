/**
 * Road network as a graph: OSM ways split at shared nodes (real junctions, not coordinate
 * guesses), junction types, corner fillets with radii, dual carriageways, and checks for gaps
 * and same-level overlaps. Pure and deterministic (input order = OSM id order).
 */
import { CLASS_RANK, MOTOR, cornerRadius, roadProfile, type RoadProfile } from './profile.js';
import type { Projection } from './project.js';
import type { RawOsm2 } from './raw.js';

export type Pt = [number, number];

export interface Edge {
  id: number;
  way: number;
  name?: string;
  /** Junction / end node ids (OSM). */
  a: number;
  b: number;
  pts: Pt[];
  p: RoadProfile;
  /** Partner edge of a dual carriageway (opposite direction, same road). */
  dual?: number;
}

export type JunctionKind = 'end' | 'bend' | 'T' | 'X' | 'merge' | 'roundabout' | 'complex';

export interface Junction {
  node: number;
  x: number;
  y: number;
  kind: JunctionKind;
  /** Motor edges meeting here. */
  edges: number[];
  /** Kerb radius used for the corner fillets. */
  radius: number;
  /** Kerb fillet polylines between adjacent arms (each from one kerb tangent to the next). */
  fillets: Pt[][];
}

export interface RoadNet {
  edges: Edge[];
  junctions: Junction[];
}

const ang = (a: Pt, b: Pt) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const norm = (a: number) => {
  let v = a % (2 * Math.PI);
  if (v < 0) v += 2 * Math.PI;
  return v;
};

export function buildNet(raw: RawOsm2, proj: Projection): RoadNet {
  const ways = raw.ways
    .map((w) => ({ w, p: roadProfile(w.t) }))
    .filter((x): x is { w: (typeof raw.ways)[number]; p: RoadProfile } => !!x.p);
  // Node use counts (any highway): a node in two ways, or twice in one, is a junction.
  const use = new Map<number, number>();
  for (const { w } of ways)
    w.nodes.forEach((n, i) => {
      const end = i === 0 || i === w.nodes.length - 1;
      use.set(n, (use.get(n) ?? 0) + (end ? 1 : 2));
    });
  const xy = new Map<number, Pt>();
  const at = (n: number): Pt => {
    let v = xy.get(n);
    if (!v) {
      const ll = raw.nodes[String(n)];
      if (!ll) throw new Error(`node ${n} missing`);
      v = proj.toLocal(ll[0], ll[1]);
      xy.set(n, v);
    }
    return v;
  };
  const edges: Edge[] = [];
  for (const { w, p } of ways) {
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (i < w.nodes.length - 1 && (use.get(w.nodes[i]!) ?? 0) <= 2) continue;
      const ids = w.nodes.slice(start, i + 1);
      edges.push({
        id: edges.length,
        way: w.id,
        ...(w.t.name ? { name: w.t.name } : {}),
        a: ids[0]!,
        b: ids[ids.length - 1]!,
        pts: ids.map(at),
        p,
      });
      start = i;
    }
  }
  markDual(edges);
  return { edges, junctions: junctions(edges, xy) };
}

/** Arm direction leaving node `n` along edge `e` (a point ~8 m out, robust to tiny first segments). */
function armAngle(e: Edge, n: number): number {
  const pts = e.a === n ? e.pts : [...e.pts].reverse();
  const o = pts[0]!;
  let q = pts[1]!;
  for (const p of pts.slice(1)) {
    q = p;
    if (Math.hypot(p[0] - o[0], p[1] - o[1]) >= 8) break;
  }
  return ang(o, q);
}

function junctions(edges: readonly Edge[], xy: ReadonlyMap<number, Pt>): Junction[] {
  const at = new Map<number, number[]>();
  for (const e of edges) {
    if (!MOTOR.has(e.p.cls)) continue;
    for (const n of e.a === e.b ? [e.a] : [e.a, e.b]) {
      const l = at.get(n) ?? [];
      l.push(e.id);
      at.set(n, l);
    }
  }
  const out: Junction[] = [];
  for (const [node, ids] of [...at].sort((a, b) => a[0] - b[0])) {
    const arms = ids
      .map((id) => ({ e: edges[id]!, a: norm(armAngle(edges[id]!, node)) }))
      .sort((p, q) => p.a - q.a);
    const deg = arms.length;
    const round = arms.some((x) => x.e.p.roundabout);
    let minGap = Math.PI * 2;
    for (let i = 0; i < deg; i++) {
      const g = norm(arms[(i + 1) % deg]!.a - arms[i]!.a);
      if (deg > 1) minGap = Math.min(minGap, g);
    }
    const kind: JunctionKind =
      deg === 1
        ? 'end'
        : deg === 2
          ? round
            ? 'roundabout'
            : 'bend'
          : round
            ? 'roundabout'
            : minGap < (35 * Math.PI) / 180
              ? 'merge'
              : deg === 3
                ? 'T'
                : deg === 4
                  ? 'X'
                  : 'complex';
    const top = arms.reduce(
      (b, x) => (CLASS_RANK.indexOf(x.e.p.cls) < CLASS_RANK.indexOf(b) ? x.e.p.cls : b),
      arms[0]!.e.p.cls,
    );
    const radius = cornerRadius(top);
    const o = xy.get(node)!;
    const fillets: Pt[][] = [];
    if (deg >= 3 && kind !== 'roundabout') {
      for (let i = 0; i < deg; i++) {
        const p = arms[i]!;
        const q = arms[(i + 1) % deg]!;
        const f = fillet(o, p.a, p.e.p.width / 2, q.a, q.e.p.width / 2, radius);
        if (f) fillets.push(f);
      }
    }
    out.push({ node, x: o[0], y: o[1], kind, edges: ids, radius, fillets });
  }
  return out;
}

/**
 * Kerb fillet between arm P (angle `ap`, half width `hp`) and the next arm Q counter-clockwise:
 * P's kerb on its CCW side and Q's kerb on its CW side, joined by an arc of radius `r` tangent
 * to both. undefined when the arms are (almost) straight through or overlap.
 */
export function fillet(
  o: Pt,
  ap: number,
  hp: number,
  aq: number,
  hq: number,
  r: number,
): Pt[] | undefined {
  const theta = norm(aq - ap);
  if (theta < 0.2 || theta > Math.PI - 0.15) return undefined;
  const dp: Pt = [Math.cos(ap), Math.sin(ap)];
  const dq: Pt = [Math.cos(aq), Math.sin(aq)];
  // Kerb lines: P offset toward Q (CCW normal), Q offset toward P (CW normal).
  const np: Pt = [-dp[1], dp[0]];
  const nq: Pt = [dq[1], -dq[0]];
  const p0: Pt = [o[0] + np[0] * hp, o[1] + np[1] * hp];
  const q0: Pt = [o[0] + nq[0] * hq, o[1] + nq[1] * hq];
  // Intersection of p0 + s·dp and q0 + t·dq.
  const den = dp[0] * dq[1] - dp[1] * dq[0];
  if (Math.abs(den) < 1e-6) return undefined;
  const s = ((q0[0] - p0[0]) * dq[1] - (q0[1] - p0[1]) * dq[0]) / den;
  const c: Pt = [p0[0] + dp[0] * s, p0[1] + dp[1] * s];
  const tan = r / Math.tan(theta / 2);
  const tp: Pt = [c[0] + dp[0] * tan, c[1] + dp[1] * tan];
  const tq: Pt = [c[0] + dq[0] * tan, c[1] + dq[1] * tan];
  // Arc centre: from tp along P's kerb normal (toward Q's side) by r.
  const cen: Pt = [tp[0] + np[0] * r, tp[1] + np[1] * r];
  const a0 = ang(cen, tp);
  const a1 = ang(cen, tq);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const n = Math.max(3, Math.ceil(Math.abs(sweep) / 0.15));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push([round2(cen[0] + Math.cos(a) * r), round2(cen[1] + Math.sin(a) * r)]);
  }
  return pts;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Pairs of one-way edges of the same road running opposite ways ≤ 40 m apart (dual carriageway). */
function markDual(edges: Edge[]): void {
  const ow = edges.filter(
    (e) => e.p.oneway !== 0 && !e.p.roundabout && !e.p.link && MOTOR.has(e.p.cls),
  );
  const mid = (e: Edge): Pt => {
    const i = e.pts.length >> 1;
    if (e.pts.length % 2) return e.pts[i]!;
    const a = e.pts[i - 1]!;
    const b = e.pts[i]!;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const dir = (e: Edge) => {
    const a = ang(e.pts[0]!, e.pts[e.pts.length - 1]!);
    return e.p.oneway === -1 ? a + Math.PI : a;
  };
  for (const e of ow) {
    if (e.dual !== undefined) continue;
    const m = mid(e);
    let best: Edge | undefined;
    let bd = 40;
    for (const f of ow) {
      if (
        f === e ||
        f.dual !== undefined ||
        f.p.cls !== e.p.cls ||
        (f.name ?? '') !== (e.name ?? '')
      )
        continue;
      if (Math.cos(dir(e) - dir(f)) > -0.85) continue;
      const d = distToLine(m, f.pts);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (best) {
      e.dual = best.id;
      best.dual = e.id;
    }
  }
}

export function distToLine(p: Pt, pts: readonly Pt[]): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distSeg(p, pts[i - 1]!, pts[i]!));
  return d;
}

function distSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const l = vx * vx + vy * vy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}

export interface NetCheck {
  edges: number;
  motorEdges: number;
  junctions: Record<JunctionKind, number>;
  dualPairs: number;
  /** Motor dead ends within 3 m of another motor road they are not joined to (likely gap). */
  gaps: Pt[];
  /** Motor segments crossing on the same layer without a shared node (overlap). */
  overlaps: Pt[];
  widthFrom: Record<RoadProfile['widthFrom'], number>;
}

/** Network checks (counts + positions) for the audit and the tests. */
export function checkNet(net: RoadNet): NetCheck {
  const motor = net.edges.filter((e) => MOTOR.has(e.p.cls) && !e.p.tunnel);
  const kinds: Record<JunctionKind, number> = {
    end: 0,
    bend: 0,
    T: 0,
    X: 0,
    merge: 0,
    roundabout: 0,
    complex: 0,
  };
  for (const j of net.junctions) kinds[j.kind]++;
  // Segment grid (32 m) for neighbour queries.
  const G = 32;
  const grid = new Map<string, [number, number][]>();
  motor.forEach((e, ei) =>
    e.pts.slice(1).forEach((b, si) => {
      const a = e.pts[si]!;
      for (
        let gx = Math.floor(Math.min(a[0], b[0]) / G);
        gx <= Math.floor(Math.max(a[0], b[0]) / G);
        gx++
      )
        for (
          let gy = Math.floor(Math.min(a[1], b[1]) / G);
          gy <= Math.floor(Math.max(a[1], b[1]) / G);
          gy++
        ) {
          const k = `${gx},${gy}`;
          const l = grid.get(k) ?? [];
          l.push([ei, si]);
          grid.set(k, l);
        }
    }),
  );
  const near = (p: Pt) => {
    const out = new Set<string>();
    const gx = Math.floor(p[0] / G);
    const gy = Math.floor(p[1] / G);
    const r: [number, number][] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const s of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const k = `${s[0]},${s[1]}`;
          if (!out.has(k)) {
            out.add(k);
            r.push(s);
          }
        }
    return r;
  };
  const gaps: Pt[] = [];
  for (const j of net.junctions) {
    if (j.kind !== 'end') continue;
    const p: Pt = [j.x, j.y];
    const own = new Set(j.edges);
    const hit = near(p).some(([ei, si]) => {
      const e = motor[ei]!;
      if (own.has(e.id) || e.a === j.node || e.b === j.node) return false;
      return distSeg(p, e.pts[si]!, e.pts[si + 1]!) < 3;
    });
    if (hit) gaps.push(p);
  }
  const overlaps: Pt[] = [];
  const seen = new Set<string>();
  motor.forEach((e, ei) =>
    e.pts.slice(1).forEach((b, si) => {
      const a = e.pts[si]!;
      const cand = new Map<string, [number, number]>();
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / G));
      for (let k = 0; k <= steps; k++)
        for (const s of near([
          a[0] + ((b[0] - a[0]) * k) / steps,
          a[1] + ((b[1] - a[1]) * k) / steps,
        ]))
          cand.set(`${s[0]},${s[1]}`, s);
      for (const [fj, sj] of cand.values()) {
        if (fj <= ei) continue;
        const f = motor[fj]!;
        if (f.p.layer !== e.p.layer || f.p.bridge !== e.p.bridge) continue;
        const x = segX(a, b, f.pts[sj]!, f.pts[sj + 1]!);
        if (!x) continue;
        const k = `${Math.round(x[0])},${Math.round(x[1])}`;
        if (seen.has(k)) continue;
        // Shared vertex = a real junction, not an overlap.
        if ([e.a, e.b].some((n) => n === f.a || n === f.b)) {
          const shared = [a, b].some((p) => Math.hypot(p[0] - x[0], p[1] - x[1]) < 0.05);
          if (shared) continue;
        }
        seen.add(k);
        overlaps.push([round2(x[0]), round2(x[1])]);
      }
    }),
  );
  const widthFrom = { width: 0, lanes: 0, default: 0 };
  for (const e of motor) widthFrom[e.p.widthFrom]++;
  return {
    edges: net.edges.length,
    motorEdges: motor.length,
    junctions: kinds,
    dualPairs: net.edges.filter((e) => e.dual !== undefined).length / 2,
    gaps,
    overlaps,
    widthFrom,
  };
}

/** Proper crossing of two segments (endpoints touching do not count). */
function segX(a: Pt, b: Pt, c: Pt, d: Pt): Pt | undefined {
  const r: Pt = [b[0] - a[0], b[1] - a[1]];
  const s: Pt = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return undefined;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}
