/**
 * The strip between a slanted building's tile rooms and its outline (vector walls).
 *
 * Rooms are laid out on the conservative fill (tiles wholly inside the outline), so along a
 * slanted wall a band of partly covered tiles stays outside every room. Without this pass it
 * was fenced off by the rooms' exterior tile walls (invisible: the outline is drawn instead) and
 * had no floor on upper storeys: the player hit an unseen wall a metre before the visible one.
 *
 * Here every strip tile joins the nearest room of its level (breadth-first from the room
 * tiles): the exterior tile walls between a room and its own strip tiles are dropped (doors and
 * windows stay: the outline's gates read them), upper storeys get floor there, and where two
 * rooms meet inside the strip a wall segment clipped to the outline carries their partition on
 * to the outer wall. Strip tiles keep room 0, so exterior openings stay exterior everywhere.
 */
import type { BuildingLevel, WallSegment } from './building.js';

/** Strip tiles further than this (tiles, 4-neighbour steps) from a room stay empty. */
const STRIP_REACH = 3;
/** Sub-samples per tile side for "the outline covers part of this tile". */
const SAMPLES = 4;

/** Even-odd point-in-rings (x, y pairs, world metres). */
function insideRings(rings: readonly Float64Array[], x: number, y: number): boolean {
  let c = false;
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i]!;
      const yi = r[2 * i + 1]!;
      const xj = r[2 * j]!;
      const yj = r[2 * j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/** Whether the rings cover part of tile (tx, ty) (sub-sampled). */
function coversTile(rings: readonly Float64Array[], tx: number, ty: number): boolean {
  for (let a = 0; a < SAMPLES; a++)
    for (let b = 0; b < SAMPLES; b++)
      if (insideRings(rings, tx + (a + 0.5) / SAMPLES, ty + (b + 0.5) / SAMPLES)) return true;
  return false;
}

/** Pieces of segment (x0, y0)–(x1, y1) inside the rings. */
export function clipToRings(
  rings: readonly Float64Array[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number, number][] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const ts = [0, 1];
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = r[2 * j]!;
      const ay = r[2 * j + 1]!;
      const ex = r[2 * i]! - ax;
      const ey = r[2 * i + 1]! - ay;
      const det = dx * ey - dy * ex;
      if (Math.abs(det) < 1e-12) continue;
      const t = ((ax - x0) * ey - (ay - y0) * ex) / det;
      const s = ((ax - x0) * dy - (ay - y0) * dx) / det;
      if (t > 0 && t < 1 && s >= 0 && s <= 1) ts.push(t);
    }
  }
  ts.sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  for (let k = 0; k + 1 < ts.length; k++) {
    const a = ts[k]!;
    const b = ts[k + 1]!;
    if (b - a < 1e-6) continue;
    const m = (a + b) / 2;
    if (!insideRings(rings, x0 + dx * m, y0 + dy * m)) continue;
    const last = out[out.length - 1];
    const px = x0 + dx * a;
    const py = y0 + dy * a;
    if (last && Math.abs(last[2] - px) < 1e-9 && Math.abs(last[3] - py) < 1e-9) {
      last[2] = x0 + dx * b;
      last[3] = y0 + dy * b;
    } else out.push([px, py, x0 + dx * b, y0 + dy * b]);
  }
  return out;
}

export interface StripInput {
  /** Outline rings (outer + courtyards), world metres. */
  rings: readonly Float64Array[];
  levels: Map<number, BuildingLevel>;
  /** Grid origin (world tiles) and tile size; level arrays are (w + 1) × (h + 1). */
  fx: number;
  fy: number;
  w: number;
  h: number;
  /** Footprint (w × h, 1 = room tiles' fill). */
  mask: Uint8Array;
  /** World tile taken by another building (never part of this strip). */
  blocked: (tx: number, ty: number) => boolean;
  /** Edge palette id → kind (`wall`, `door`, `window`, ...). */
  kindOf: (v: number) => string | undefined;
}

const NB = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Joins the strip to the rooms (see the module doc): edits `levels` in place (exterior tile
 * walls toward the strip, upper-storey strip floor) and returns the partition wall segments.
 */
export function joinStrip(inp: StripInput): WallSegment[] {
  const { rings, levels, fx, fy, w, h, mask, blocked, kindOf } = inp;
  const W = w + 1;
  const strip = new Uint8Array(w * h);
  let any = false;
  for (let gy = 0; gy < h; gy++)
    for (let gx = 0; gx < w; gx++) {
      if (mask[gy * w + gx] || blocked(fx + gx, fy + gy)) continue;
      if (!coversTile(rings, fx + gx, fy + gy)) continue;
      strip[gy * w + gx] = 1;
      any = true;
    }
  if (!any) return [];
  const out: WallSegment[] = [];
  for (const [z, L] of levels) {
    const roomOf = (gx: number, gy: number) =>
      gx < 0 || gy < 0 || gx >= w || gy >= h || !mask[gy * w + gx] ? 0 : L.room[gy * W + gx]!;
    // Breadth-first from the room tiles: label = room, src = level index of the source tile.
    const label = new Int32Array(w * h);
    const src = new Int32Array(w * h).fill(-1);
    const dist = new Uint8Array(w * h);
    const q: number[] = [];
    for (let gy = 0; gy < h; gy++)
      for (let gx = 0; gx < w; gx++) {
        const rm = roomOf(gx, gy);
        if (!rm) continue;
        label[gy * w + gx] = rm;
        src[gy * w + gx] = gy * W + gx;
        q.push(gy * w + gx);
      }
    for (let k = 0; k < q.length; k++) {
      const i = q[k]!;
      if (dist[i]! >= STRIP_REACH) continue;
      const gx = i % w;
      const gy = (i - gx) / w;
      for (const [dx, dy] of NB) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!strip[j] || label[j]) continue;
        label[j] = label[i]!;
        src[j] = src[i]!;
        dist[j] = dist[i]! + 1;
        q.push(j);
      }
    }
    const wallOn = (ax: number, ay: number, bx: number, by: number) => {
      for (const [x0, y0, x1, y1] of clipToRings(rings, ax, ay, bx, by))
        if (Math.hypot(x1 - x0, y1 - y0) > 1e-3) out.push({ x0, y0, x1, y1, z });
    };
    for (let gy = 0; gy < h; gy++)
      for (let gx = 0; gx < w; gx++) {
        const s = gy * w + gx;
        if (!strip[s] || !label[s]) continue;
        // Upper storeys: floor of the room the tile joined (level 0 keeps the ground).
        if (z > 0) L.floor[gy * W + gx] = L.floor[src[s]!]!;
        for (const [dx, dy] of NB) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          // Edge between the tiles: N edge of the lower one, W edge of the right one.
          const [arr, e] =
            dx !== 0 ? [L.edgeW, gy * W + Math.max(gx, nx)] : [L.edgeN, Math.max(gy, ny) * W + gx];
          const ex = fx + Math.max(gx, nx);
          const ey = fy + Math.max(gy, ny);
          const [ax, ay, bx, by] = dx !== 0 ? [ex, ey, ex, ey + 1] : [ex, ey, ex + 1, ey];
          const other = mask[j] ? roomOf(nx, ny) : strip[j] ? label[j]! : 0;
          if (mask[j]) {
            if (!other) continue; // no room there on this storey: its wall stays
            const k = arr[e] ? kindOf(arr[e]) : undefined;
            if (k === 'door' || k === 'window') continue;
            arr[e] = 0;
            if (other !== label[s]) wallOn(ax, ay, bx, by);
          } else if (strip[j] && other && other !== label[s] && (dx > 0 || dy > 0)) {
            wallOn(ax, ay, bx, by);
          }
        }
      }
  }
  return out;
}
