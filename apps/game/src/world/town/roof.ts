import { BufferAttribute, BufferGeometry } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TownCells } from './kit.js';

/** Inclusive tile footprint of a building (world tiles; x = sim x, z = sim y). */
export interface Footprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const EAVE = 0.35;
export const HIP_PITCH_DEG = 28;
export const GABLE_PITCH_DEG = 32;

/**
 * Pitched roof over a rectangular footprint (port of the mockup's `pitchedRoof`): eave overhang
 * 0.35, ridge along the longer axis, hip 28° or gable 32° (gable ends in the wall colour), fascia
 * strip in `gutter`. UVs point into the palette atlas. `y0` = top of the walls.
 */
export function pitchedRoof(
  f: Footprint,
  style: 'hip' | 'gable',
  colour: string,
  wallCell: string,
  cells: TownCells,
  y0: number,
): BufferGeometry {
  const o = EAVE;
  const pitch = Math.tan(((style === 'hip' ? HIP_PITCH_DEG : GABLE_PITCH_DEG) * Math.PI) / 180);
  const x0 = f.x0 - o;
  const x1 = f.x1 + 1 + o;
  const z0 = f.z0 - o;
  const z1 = f.z1 + 1 + o;
  const alongX = x1 - x0 >= z1 - z0;
  const half = (alongX ? z1 - z0 : x1 - x0) / 2;
  const yr = y0 + half * pitch;
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
  const rc = colour;
  const rcd = `${colour}-dark`;
  const inset = style === 'hip' ? half : 0;
  if (alongX) {
    const zm = (z0 + z1) / 2;
    const r0: V = [x0 + inset, yr, zm];
    const r1: V = [x1 - inset, yr, zm];
    quad([x0, y0, z1], [x1, y0, z1], r1, r0, rc);
    quad([x1, y0, z0], [x0, y0, z0], r0, r1, rcd);
    if (style === 'hip') {
      tri([x0, y0, z0], [x0, y0, z1], r0, rcd);
      tri([x1, y0, z1], [x1, y0, z0], r1, rc);
    } else {
      const gx0 = f.x0;
      const gx1 = f.x1 + 1;
      tri([gx0, y0, f.z0], [gx0, y0, f.z1 + 1], [gx0, yr, zm], wallCell);
      tri([gx1, y0, f.z1 + 1], [gx1, y0, f.z0], [gx1, yr, zm], wallCell);
    }
  } else {
    const xm = (x0 + x1) / 2;
    const r0: V = [xm, yr, z0 + inset];
    const r1: V = [xm, yr, z1 - inset];
    quad([x1, y0, z0], [x1, y0, z1], r1, r0, rc);
    quad([x0, y0, z1], [x0, y0, z0], r0, r1, rcd);
    if (style === 'hip') {
      tri([x0, y0, z0], [x1, y0, z0], r0, rcd);
      tri([x1, y0, z1], [x0, y0, z1], r1, rc);
    } else {
      tri([f.x1 + 1, y0, f.z0], [f.x0, y0, f.z0], [xm, yr, f.z0], wallCell);
      tri([f.x0, y0, f.z1 + 1], [f.x1 + 1, y0, f.z1 + 1], [xm, yr, f.z1 + 1], wallCell);
    }
  }
  const fy = y0 - 0.12;
  quad([x0, fy, z1], [x1, fy, z1], [x1, y0, z1], [x0, y0, z1], 'gutter');
  quad([x1, fy, z0], [x0, fy, z0], [x0, y0, z0], [x1, y0, z0], 'gutter');
  quad([x1, fy, z1], [x1, fy, z0], [x1, y0, z0], [x1, y0, z1], 'gutter');
  quad([x0, fy, z0], [x0, fy, z1], [x0, y0, z1], [x0, y0, z0], 'gutter');
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(UV), 2));
  const m = mergeVertices(g);
  m.computeVertexNormals();
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
}

/** Ridge height above the wall top for a footprint (tests, camera framing). */
export function ridgeHeight(f: Footprint, style: 'hip' | 'gable'): number {
  const w = f.x1 - f.x0 + 1 + 2 * EAVE;
  const d = f.z1 - f.z0 + 1 + 2 * EAVE;
  const pitch = Math.tan(((style === 'hip' ? HIP_PITCH_DEG : GABLE_PITCH_DEG) * Math.PI) / 180);
  return (Math.min(w, d) / 2) * pitch;
}
