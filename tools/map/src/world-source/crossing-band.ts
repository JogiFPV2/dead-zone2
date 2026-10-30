/** Plain 2D point / direction (plan metres). */
interface V {
  x: number;
  y: number;
}

/** Half width across the track of the plates of one `przejazd-kat-a` (model |x| ≤ 3.6 m). */
export const PLATE_HALF_X = 3.6;
/** Neighbouring crossings on one road (same way, or a parallel way in line) at most this far apart (m) share one band of plates. */
export const BAND_LINK_M = 16;

/** One level crossing before banding: snapped centre, track direction, yaw, scale, road. */
export interface BandItem {
  n: V;
  rot: number;
  len: number;
  /** Nearest at-grade carriageway (index) and its unit direction at `n`; none = no band. */
  road?: { i: number; d: V };
}

/** A crossing's plates and furniture after banding (furn: bit 1 = model −x, bit 2 = +x). */
export interface BandPlate {
  len: number;
  shear: number;
  furn: 0 | 1 | 2 | 3;
}

/** A plain plate between two neighbouring tracks (model x scaled by `wide`). */
export interface BandFill {
  x: number;
  y: number;
  rot: number;
  len: number;
  shear: number;
  wide: number;
}

const side = (rot: number): V => ({ x: Math.cos(rot), y: -Math.sin(rot) });

/** Model shear (local z += shear × x) that lays plates of a track at `rot` along road dir `rd`. */
export function shearAlong(rd: V, rot: number): number {
  const rx = rd.x * Math.cos(rot) - rd.y * Math.sin(rot);
  const rz = rd.x * Math.sin(rot) + rd.y * Math.cos(rot);
  if (Math.abs(rx) < 1e-3) return 0;
  return Math.round(Math.max(-1.5, Math.min(1.5, rz / rx)) * 1000) / 1000 || 0;
}

/**
 * Level crossings of parallel tracks on one road as one continuous band (Designer 27.10): the
 * same plate length and road-aligned shear on every track, signs and barriers only on the two
 * outer road sides, and plain plates filling the gaps between the tracks' plates. Pure (tests).
 */
export function crossingBands(
  items: readonly BandItem[],
  shearOf: (k: number) => number,
): { plates: BandPlate[]; fills: BandFill[] } {
  const plates: BandPlate[] = items.map((it, k) => ({ len: it.len, shear: shearOf(k), furn: 3 }));
  const fills: BandFill[] = [];
  const group = items.map((_, k) => k);
  const root = (k: number): number => (group[k] === k ? k : (group[k] = root(group[k]!)));
  items.forEach((a, i) =>
    items.forEach((b, j) => {
      if (j <= i || !a.road || !b.road) return;
      if (Math.hypot(a.n.x - b.n.x, a.n.y - b.n.y) > BAND_LINK_M) return;
      // One road (maybe split into several OSM ways): parallel, b on a's road line.
      const rd = a.road.d;
      const par = Math.abs(rd.x * b.road.d.y - rd.y * b.road.d.x) < 0.26;
      const off = Math.abs((b.n.x - a.n.x) * rd.y - (b.n.y - a.n.y) * rd.x);
      if (a.road.i === b.road.i || (par && off < 3)) group[root(i)] = root(j);
    }),
  );
  const groups = new Map<number, number[]>();
  items.forEach((_, k) => {
    const r = root(k);
    groups.set(r, [...(groups.get(r) ?? []), k]);
  });
  for (const ks of groups.values()) {
    if (ks.length < 2) continue;
    const rd = items[ks[0]!]!.road!.d;
    const len = Math.max(...ks.map((k) => items[k]!.len));
    ks.sort((a, b) => dot(items[a]!.n, rd) - dot(items[b]!.n, rd));
    for (const k of ks) {
      const it = items[k]!;
      const s = side(it.rot);
      let furn = 3;
      for (const o of ks) {
        if (o === k) continue;
        const v = (items[o]!.n.x - it.n.x) * s.x + (items[o]!.n.y - it.n.y) * s.y;
        if (Math.abs(v) > 0.5) furn &= v < 0 ? ~1 : ~2;
      }
      plates[k] = { len, shear: shearAlong(rd, it.rot), furn: furn as BandPlate['furn'] };
    }
    for (let p = 0; p + 1 < ks.length; p++) {
      const a = items[ks[p]!]!;
      const b = items[ks[p + 1]!]!;
      const s = side(a.rot);
      const across = Math.abs((b.n.x - a.n.x) * s.x + (b.n.y - a.n.y) * s.y);
      const gap = across - 2 * PLATE_HALF_X;
      if (gap <= 0.05) continue;
      fills.push({
        x: Math.round(((a.n.x + b.n.x) / 2) * 100) / 100,
        y: Math.round(((a.n.y + b.n.y) / 2) * 100) / 100,
        rot: a.rot,
        len,
        shear: shearAlong(rd, a.rot),
        // A little overlap with both plates: no seam.
        wide: Math.round((gap + 0.2) * 100) / 100,
      });
    }
  }
  return { plates, fills };
}

const dot = (p: V, d: V) => p.x * d.x + p.y * d.y;

/**
 * Crossings on one track whose plates nearly meet (two roads close together, Designer 27.10:
 * no gap in the band): each plate stretched to the midpoint between them. Mutates `plates`.
 */
export function joinAlong(items: readonly BandItem[], plates: BandPlate[]): void {
  items.forEach((a, i) => {
    const d = { x: Math.sin(a.rot), y: Math.cos(a.rot) };
    const s = side(a.rot);
    items.forEach((b, j) => {
      if (j === i) return;
      const dx = b.n.x - a.n.x;
      const dy = b.n.y - a.n.y;
      const along = Math.abs(dx * d.x + dy * d.y);
      if (Math.abs(dx * s.x + dy * s.y) > 0.5 || along > 2 * JOIN_HALF_M) return;
      const need = Math.round((along / (2 * PLATE_HALF_Z) + 0.03) * 100) / 100;
      if (need > plates[i]!.len) plates[i] = { ...plates[i]!, len: need };
    });
  });
}

/** Half length (model z) of the plates at scale 1, and the farthest a joined neighbour sits (m). */
const PLATE_HALF_Z = 3.6;
const JOIN_HALF_M = 9;
