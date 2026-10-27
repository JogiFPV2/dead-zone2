import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { spotHash } from './species.js';

/** Leaf cards in one crown (2 triangles each). */
export const CROWN_CARDS = 44;

/**
 * Unit crown (radius 1 around the origin): `CROWN_CARDS` leaf-cluster quads at random spots
 * and angles inside the sphere. Normals point out of the crown centre (soft round shading
 * instead of flat cards); uv over the whole leaf texture.
 */
export function crownGeometry(cards = CROWN_CARDS): BufferGeometry {
  const pos = new Float32Array(cards * 4 * 3);
  const nrm = new Float32Array(cards * 4 * 3);
  const uv = new Float32Array(cards * 4 * 2);
  const idx: number[] = [];
  const q = new Quaternion();
  const c = new Vector3();
  const p = new Vector3();
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  for (let i = 0; i < cards; i++) {
    // Even-ish spread: a direction on the sphere, radius 0.3..0.8 (outer cards make the outline).
    const y = 1 - 2 * ((i + 0.5) / cards);
    const a = i * 2.39996 + spotHash(i, 9, 3);
    const rr = Math.sqrt(1 - y * y);
    const r = 0.3 + 0.5 * spotHash(i, 8, 3);
    c.set(Math.cos(a) * rr * r, y * r, Math.sin(a) * rr * r);
    q.setFromAxisAngle(
      p.set(spotHash(i, 1, 3) - 0.5, spotHash(i, 2, 3) - 0.5, spotHash(i, 3, 3) - 0.5).normalize(),
      Math.PI * spotHash(i, 4, 3),
    );
    const half = 0.42 + 0.12 * spotHash(i, 5, 3);
    corners.forEach(([u, v], k) => {
      p.set(u * half, v * half, 0)
        .applyQuaternion(q)
        .add(c);
      const o = (i * 4 + k) * 3;
      pos[o] = p.x;
      pos[o + 1] = p.y;
      pos[o + 2] = p.z;
      const n = p.lengthSq() > 1e-6 ? p.clone().normalize() : new Vector3(0, 1, 0);
      nrm[o] = n.x;
      nrm[o + 1] = n.y;
      nrm[o + 2] = n.z;
      uv[(i * 4 + k) * 2] = (u + 1) / 2;
      uv[(i * 4 + k) * 2 + 1] = (v + 1) / 2;
    });
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Unit trunk (height 1, base radius 1): tapered stem and three limbs into the crown. Scaled
 * per instance (radius × height), so one geometry serves every species.
 */
export function trunkGeometry(): BufferGeometry {
  const stem = new CylinderGeometry(0.55, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  const limbs = [0, 2.1, 4.2].map((a) => {
    const g = new CylinderGeometry(0.25, 0.45, 0.45, 4, 1, true).translate(0, 0.225, 0);
    const m = new Matrix4().compose(
      new Vector3(0, 0.7, 0),
      new Quaternion().setFromAxisAngle(new Vector3(Math.cos(a), 0, Math.sin(a)), 0.6),
      new Vector3(1, 1, 1),
    );
    return g.applyMatrix4(m);
  });
  const merged = mergeGeometries([stem, ...limbs]);
  if (!merged) throw new Error('trunk geometry');
  return merged;
}

/** Triangles of a geometry (indexed or not). */
export function triangles(g: BufferGeometry): number {
  return (g.index ? g.index.count : g.attributes.position!.count) / 3;
}
