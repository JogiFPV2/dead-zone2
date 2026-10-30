import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from 'three';

/** Level crossing model (`przejazd-kat-a`) and its parts: plates + track, −x and +x furniture. */
export const CROSSING_MODEL = 'przejazd-kat-a';
export const CROSSING_CORE = `${CROSSING_MODEL}#core`;
export const CROSSING_LEFT = `${CROSSING_MODEL}#l`;
export const CROSSING_RIGHT = `${CROSSING_MODEL}#r`;
/** Plain plate between two tracks' plates (unit width in x), built from the core's plates. */
export const CROSSING_FILL = `${CROSSING_MODEL}#fill`;
/** Plates end at |x| = 3.6 m; signs and barriers stand beyond (|x| ≥ 4.3 m). */
const FURN_FROM_X = 3.9;

/** Triangles of `g` whose centroid x passes `keep` (attributes copied). Pure (tests). */
export function trianglesWhere(g: BufferGeometry, keep: (cx: number) => boolean): BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const names = Object.keys(src.attributes);
  const out: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    if (!keep(cx)) continue;
    for (const n of names) {
      const a = src.getAttribute(n);
      for (let v = t; v < t + 3; v++)
        for (let c = 0; c < a.itemSize; c++) out[n]!.push(a.getComponent(v, c));
    }
  }
  const res = new BufferGeometry();
  for (const n of names)
    res.setAttribute(n, new Float32BufferAttribute(out[n]!, src.getAttribute(n).itemSize));
  res.computeBoundingSphere();
  return res;
}

/**
 * The crossing split in three (same material, instanced apart): plates with the track, and the
 * signs + barrier post on each side, so a multi-track crossing gets one set per road side.
 */
export function splitCrossing(g: BufferGeometry): Map<string, BufferGeometry> {
  return new Map([
    [CROSSING_CORE, liftRails(trianglesWhere(g, (x) => Math.abs(x) < FURN_FROM_X))],
    [CROSSING_LEFT, trianglesWhere(g, (x) => x <= -FURN_FROM_X)],
    [CROSSING_RIGHT, trianglesWhere(g, (x) => x >= FURN_FROM_X)],
    [CROSSING_FILL, fillPlate(g)],
  ]);
}

/** Rail heads sit 1 cm over the plates (0.65 m) in the model: raised so they show on the road. */
export const RAIL_LIFT = 0.04;

/** Rail head vertices (|x| 0.6–0.9 m, top at 0.66 m) moved up by RAIL_LIFT. Mutates `g`. */
export function liftRails(g: BufferGeometry): BufferGeometry {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(pos.getX(i));
    if (ax > 0.6 && ax < 0.9 && pos.getY(i) > 0.655) pos.setY(i, pos.getY(i) + RAIL_LIFT);
  }
  pos.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/**
 * A plate slab 1 m wide (x), as high and long (z) as the crossing's plates (|x| 1.5–3.6 m) and in
 * their colour: scaled in x over the gap between neighbouring tracks' plates. Pure (tests).
 */
export function fillPlate(g: BufferGeometry): BufferGeometry {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  let top = 0;
  let z0 = Infinity;
  let z1 = -Infinity;
  let at = -1;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(pos.getX(i));
    if (ax < 1.5 || ax > 3.65 || pos.getY(i) > 0.7) continue;
    z0 = Math.min(z0, pos.getZ(i));
    z1 = Math.max(z1, pos.getZ(i));
    if (pos.getY(i) >= top) [top, at] = [pos.getY(i), i];
  }
  if (at < 0) [top, z0, z1] = [0.65, -3.6, 3.6];
  const box = new BoxGeometry(1, top, z1 - z0).toNonIndexed();
  box.translate(0, top / 2, (z0 + z1) / 2);
  box.deleteAttribute('uv');
  const rgb = col && at >= 0 ? [col.getX(at), col.getY(at), col.getZ(at)] : [0.6, 0.6, 0.58];
  const n = box.getAttribute('position').count;
  box.setAttribute(
    'color',
    new Float32BufferAttribute(Array.from({ length: n }, () => rgb).flat(), 3),
  );
  box.computeBoundingSphere();
  return box;
}
