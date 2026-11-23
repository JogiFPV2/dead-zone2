import type { BufferGeometry } from 'three';
import {
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, type PaintedPlantLayer } from '../../render/painted-ground.js';

/**
 * Plant models of the „Malowany” style, built in code (no Blender in the pipeline): branched
 * trunks and leaf clumps (deformed, smoothed icospheres with vertex shading, lighter on top).
 * Each model is two geometries (bark, leaves) normalised to height 1 at the origin, so an instance
 * is scaled by the tree's height. Ported from the approved reference scene (22.11).
 */
export const PAINTED_PLANTS = [
  'dab',
  'klon',
  'lipa',
  'jablon',
  'brzoza',
  'sosna',
  'swierk',
  'krzew',
] as const;
export type PaintedPlant = (typeof PAINTED_PLANTS)[number];

export interface PlantModel {
  bark: BufferGeometry;
  leaves: BufferGeometry;
  barkTex: PaintedPlantLayer;
  leafTex: PaintedPlantLayer;
}

/** Content tree species → plant model (unknown species: by leaf type). */
export const SPECIES_PLANT: Readonly<Record<string, PaintedPlant>> = {
  oak: 'dab',
  maple: 'klon',
  linden: 'lipa',
  apple: 'jablon',
  birch: 'brzoza',
  pine: 'sosna',
  spruce: 'swierk',
  hazel: 'krzew',
};

type Rand = () => number;

/** Geometry parts by texture, merged at the end. */
class Parts {
  readonly bark: BufferGeometry[] = [];
  readonly leaves: BufferGeometry[] = [];
}

const UP = new Vector3(0, 1, 0);

function clean(g: BufferGeometry, color: boolean): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const a of Object.keys(out.attributes))
    if (!['position', 'normal', 'uv', 'color'].includes(a)) out.deleteAttribute(a);
  if (color && !out.getAttribute('color'))
    out.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(out.getAttribute('position').count * 3).fill(1), 3),
    );
  return out;
}

/** A tapered limb from `from` along `dir` (bark UV in metres); returns its tip. */
function branch(
  p: Parts,
  from: Vector3,
  dir: Vector3,
  len: number,
  r0: number,
  r1: number,
): Vector3 {
  const d = dir.clone().normalize();
  const g = new CylinderGeometry(r1, r0, len, 6, 1);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.6, uv.getY(i) * len);
  g.translate(0, len / 2, 0);
  g.applyMatrix4(
    new Matrix4().compose(from, new Quaternion().setFromUnitVectors(UP, d), new Vector3(1, 1, 1)),
  );
  p.bark.push(g);
  return from.clone().addScaledVector(d, len);
}

/** A leaf clump: smoothed, wobbled icosphere, darker underneath (vertex colour). */
function clump(p: Parts, c: Vector3, rad: number, r: Rand, squash = 0.85, seed = 1): void {
  let g: BufferGeometry = new IcosahedronGeometry(rad, 1);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const uvA = new Float32Array(pos.count * 2);
  const ph = r() * 10;
  const v = new Vector3();
  const u = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    u.copy(v).normalize();
    const n =
      1 +
      0.2 * Math.sin(u.x * 5.1 + ph) * Math.cos(u.y * 4.3 + seed) +
      0.12 * Math.sin(u.z * 7.3 + ph);
    v.multiplyScalar(n);
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
    const t = Math.min(1, Math.max(0, (u.y + 1) / 2));
    const k = 0.6 + 0.55 * t;
    col.set([k * 0.95, k, k * 0.86], i * 3);
    uvA[i * 2] = (Math.atan2(u.z, u.x) / (2 * Math.PI) + 0.5) * 3;
    uvA[i * 2 + 1] = (u.y * 0.5 + 0.5) * 1.5;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('uv', new BufferAttribute(uvA, 2));
  g.computeVertexNormals();
  g.translate(c.x, c.y, c.z);
  p.leaves.push(g);
}

/** Broadleaf with a spreading crown on 6 limbs (oak, apple). */
function broadleaf(p: Parts, r: Rand, h: number, spread = 1): void {
  const trunkH = h * 0.42;
  branch(p, new Vector3(), UP, trunkH, 0.26, 0.17);
  branch(p, new Vector3(), UP, 0.4, 0.4, 0.26);
  const tips: Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + r() * 0.5;
    const tilt = 0.6 + r() * 0.3;
    const y0 = trunkH * (0.7 + r() * 0.3);
    const dir = new Vector3(
      Math.cos(a) * Math.sin(tilt) * spread,
      Math.cos(tilt),
      Math.sin(a) * Math.sin(tilt) * spread,
    );
    tips.push(branch(p, new Vector3(0, y0, 0), dir, h * (0.25 + r() * 0.12), 0.13, 0.06));
  }
  tips.push(new Vector3(0, h * 0.78, 0));
  for (const t of tips)
    for (let k = 0; k < 3; k++)
      clump(
        p,
        t.clone().add(new Vector3((r() - 0.5) * 1.6, (r() - 0.2) * 1.2, (r() - 0.5) * 1.6)),
        h * (0.13 + r() * 0.06),
        r,
        0.85,
        k,
      );
}

/** Linden / maple: short trunk, dense round crown. */
function roundCrown(p: Parts, r: Rand, h: number): void {
  const top = branch(p, new Vector3(), UP, h * 0.45, 0.32, 0.22);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 6.28 + r();
    branch(p, top.clone(), new Vector3(Math.cos(a), 1.1, Math.sin(a)), h * 0.25, 0.14, 0.06);
  }
  const ctr = new Vector3(0, h * 0.68, 0);
  for (let i = 0; i < 16; i++) {
    const u = new Vector3(r() - 0.5, (r() - 0.35) * 0.8, r() - 0.5).normalize();
    clump(p, ctr.clone().addScaledVector(u, h * 0.24), h * (0.13 + r() * 0.04), r, 0.85, i);
  }
}

function birch(p: Parts, r: Rand, h: number): void {
  const lean = new Vector3((r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25);
  const top = branch(p, new Vector3(), lean, h * 0.8, 0.15, 0.05);
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const y = h * (0.35 + r() * 0.4);
    const end = branch(
      p,
      new Vector3(lean.x * y, y, lean.z * y),
      new Vector3(Math.cos(a), 0.9, Math.sin(a)),
      h * 0.16,
      0.05,
      0.02,
    );
    clump(p, end.add(new Vector3(0, -0.4, 0)), h * (0.09 + r() * 0.03), r, 1.25, i);
  }
  clump(p, top, h * 0.1, r, 1.3, 3);
}

/** Scots pine: tall bare stem, umbrella crown at the top. */
function pine(p: Parts, r: Rand, h: number): void {
  const lean = new Vector3((r() - 0.5) * 0.08, 1, (r() - 0.5) * 0.08);
  const top = branch(p, new Vector3(), lean, h * 0.82, 0.24, 0.1);
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2;
    const y = h * (0.55 + r() * 0.25);
    const end = branch(
      p,
      new Vector3(lean.x * y, y, lean.z * y),
      new Vector3(Math.cos(a), 0.6 + r() * 0.4, Math.sin(a)),
      h * (0.12 + r() * 0.06),
      0.07,
      0.03,
    );
    clump(p, end, h * (0.08 + r() * 0.03), r, 0.55, i);
  }
  for (let i = 0; i < 5; i++)
    clump(
      p,
      top.clone().add(new Vector3((r() - 0.5) * 2.4, (r() - 0.3) * 1.2, (r() - 0.5) * 2.4)),
      h * (0.09 + r() * 0.03),
      r,
      0.55,
      i + 9,
    );
}

/** Spruce: a cone of needle tiers. */
function spruce(p: Parts, r: Rand, h: number): void {
  branch(p, new Vector3(), UP, h * 0.95, 0.2, 0.05);
  const tiers = 7;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = h * (0.15 + f * 0.75);
    const rad = h * 0.26 * (1 - f * 0.82);
    const g = new ConeGeometry(rad, h * 0.22, 9, 1, true);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++)
      if (pos.getY(i) < 0) {
        const k = 1 + (r() - 0.5) * 0.3;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) - r() * 0.3, pos.getZ(i) * k);
      }
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = 0.62 + 0.5 * f + (pos.getY(i) > 0 ? 0.12 : 0);
      col.set([k * 0.92, k, k * 0.95], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rad * 4, uv.getY(i) * 2);
    g.computeVertexNormals();
    g.applyMatrix4(new Matrix4().makeRotationY(r() * 6).setPosition(0, y, 0));
    p.leaves.push(g);
  }
}

function shrub(p: Parts, r: Rand, size: number): void {
  branch(p, new Vector3(), UP, size * 0.3, 0.05, 0.03);
  for (let i = 0; i < 5; i++)
    clump(
      p,
      new Vector3((r() - 0.5) * size, size * 0.35 + r() * size * 0.2, (r() - 0.5) * size),
      size * (0.35 + r() * 0.15),
      r,
      0.75,
      i,
    );
}

const BUILD: Record<
  PaintedPlant,
  {
    seed: number;
    h: number;
    bark: PaintedPlantLayer;
    leaf: PaintedPlantLayer;
    make: (p: Parts, r: Rand, h: number) => void;
  }
> = {
  dab: { seed: 11, h: 9, bark: 'kora', leaf: 'liscie', make: (p, r, h) => broadleaf(p, r, h) },
  klon: { seed: 57, h: 12, bark: 'kora', leaf: 'liscie', make: roundCrown },
  lipa: { seed: 51, h: 12, bark: 'kora', leaf: 'liscie_jasne', make: roundCrown },
  jablon: {
    seed: 19,
    h: 6,
    bark: 'kora',
    leaf: 'liscie_jasne',
    make: (p, r, h) => broadleaf(p, r, h, 1.2),
  },
  brzoza: { seed: 41, h: 11, bark: 'kora_brzozy', leaf: 'liscie_jasne', make: birch },
  sosna: { seed: 21, h: 16, bark: 'kora_sosny', leaf: 'igly', make: pine },
  swierk: { seed: 31, h: 12, bark: 'kora', leaf: 'igly', make: spruce },
  krzew: { seed: 61, h: 1.6, bark: 'kora', leaf: 'liscie', make: shrub },
};

const built = new Map<PaintedPlant, PlantModel>();

/** The model of a plant (built once), normalised to height 1, base at the origin. */
export function plantModel(id: PaintedPlant): PlantModel {
  let m = built.get(id);
  if (m) return m;
  const b = BUILD[id];
  const p = new Parts();
  b.make(p, rng(b.seed), b.h);
  const norm = (list: BufferGeometry[], color: boolean) => {
    const g = mergeGeometries(list.map((x) => clean(x, color)));
    g.computeBoundingBox();
    const top = g.boundingBox!.max.y;
    return { g, top };
  };
  const bark = norm(p.bark, false);
  const leaves = norm(p.leaves, true);
  const s = 1 / Math.max(bark.top, leaves.top);
  bark.g.scale(s, s, s);
  leaves.g.scale(s, s, s);
  for (const g of [bark.g, leaves.g]) {
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }
  m = { bark: bark.g, leaves: leaves.g, barkTex: b.bark, leafTex: b.leaf };
  built.set(id, m);
  return m;
}
