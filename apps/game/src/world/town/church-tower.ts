import { BufferAttribute, BufferGeometry } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { bldHash } from './bld-v2.js';
import type { TownCells } from './kit.js';
import type { Footprint } from './roof.js';

/** Tower side (m), shaft height above the wall top (m), spire / helm height (m). */
export const TOWER_SIDE = 4;
export const TOWER_SHAFT = 9;
export const TOWER_SPIRE = 7;

/**
 * bld v2 church tower (look-spec.md B "wieża kościoła, 2 warianty"): square shaft in the wall
 * colour at the middle of one short end of the footprint, topped by a tall spire (variant 0) or a
 * helm = low pyramid + lantern + point (variant 1), roof colour. Palette UVs: goes into the same
 * BatchedMesh as the roof (+0 draw calls). `y0` = top of the walls.
 */
export function churchTower(
  f: Footprint,
  building: number,
  wallCell: string,
  roofCell: string,
  cells: TownCells,
  y0: number,
): BufferGeometry {
  const P: number[] = [];
  const UV: number[] = [];
  type V = [number, number, number];
  const tri = (a: V, b: V, c: V, cell: string) => {
    P.push(...a, ...b, ...c);
    const u = cells.uv(cell);
    UV.push(...u, ...u, ...u);
  };
  const quad = (a: V, b: V, c: V, d: V, cell: string) => {
    tri(a, b, c, cell);
    tri(a, c, d, cell);
  };
  const w = f.x1 + 1 - f.x0;
  const d = f.z1 + 1 - f.z0;
  const s = Math.min(TOWER_SIDE, Math.max(2, Math.min(w, d) * 0.6)) / 2;
  const end = bldHash(building, 0, 7) < 0.5;
  const cx = w >= d ? (end ? f.x0 + s : f.x1 + 1 - s) : (f.x0 + f.x1 + 1) / 2;
  const cz = w >= d ? (f.z0 + f.z1 + 1) / 2 : end ? f.z0 + s : f.z1 + 1 - s;
  const box = (yb: number, yt: number, r: number, cell: string) => {
    const a: [number, number] = [cx - r, cz - r];
    const b: [number, number] = [cx + r, cz - r];
    const c: [number, number] = [cx + r, cz + r];
    const e: [number, number] = [cx - r, cz + r];
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, e],
      [e, a],
    ] as const)
      quad([q[0], yb, q[1]], [p[0], yb, p[1]], [p[0], yt, p[1]], [q[0], yt, q[1]], cell);
    quad([a[0], yt, a[1]], [e[0], yt, e[1]], [c[0], yt, c[1]], [b[0], yt, b[1]], cell);
  };
  const pyramid = (yb: number, h: number, r: number, cell: string) => {
    const top: V = [cx, yb + h, cz];
    const c: V[] = [
      [cx - r, yb, cz - r],
      [cx + r, yb, cz - r],
      [cx + r, yb, cz + r],
      [cx - r, yb, cz + r],
    ];
    for (let i = 0; i < 4; i++) tri(c[(i + 1) % 4]!, c[i]!, top, i % 2 ? `${cell}-dark` : cell);
  };
  const yt = y0 + TOWER_SHAFT;
  box(y0 - 2, yt, s, wallCell);
  box(yt, yt + 0.3, s + 0.25, 'trim-light');
  if (bldHash(building, 0, 8) < 0.5) {
    pyramid(yt + 0.3, TOWER_SPIRE, s + 0.2, roofCell);
  } else {
    pyramid(yt + 0.3, 2, s + 0.2, roofCell);
    box(yt + 2.3, yt + 3.8, s * 0.35, roofCell);
    pyramid(yt + 3.8, TOWER_SPIRE - 3.5, s * 0.4, roofCell);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(UV), 2));
  const m = mergeVertices(g);
  m.computeVertexNormals();
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
}
