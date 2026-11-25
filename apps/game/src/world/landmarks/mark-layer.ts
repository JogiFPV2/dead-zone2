import { ENGINE_HALF, ENGINE_HALF_W, type GenMark } from '@deadzone/map/world-source';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Landmark structures of the streamed chunks (`GenColumn.marks`, stw2): factory chimneys at their
 * OSM height (the CHP stacks: 120 m and 95 m), water towers, silos, wooden belfries and the Ty2
 * steam engine at Rozwadów station. Simple procedural models with flat vertex colours, one mesh
 * per chunk. Render only (the sim blocks their bases through `SimChunk.blockers`).
 */

const C = {
  concrete: '#a7a39b',
  concreteDark: '#7d7a73',
  soot: '#3b3936',
  red: '#b5402f',
  white: '#e9e5dc',
  brick: '#9a4f37',
  tank: '#b9b6ae',
  wood: '#5e4230',
  woodDark: '#43301f',
  shingle: '#4f4a44',
  black: '#26272a',
  wheelRed: '#9c2f25',
  rail: '#55534f',
} as const;

type Part = BufferGeometry;

function paint(g: BufferGeometry, hex: string): BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new Color(hex);
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/** Vertical cylinder from y0 to y1 (radii at the bottom / top), centred on the axis. */
function cyl(r0: number, r1: number, y0: number, y1: number, hex: string, seg = 16): Part {
  const g = new CylinderGeometry(r1, r0, y1 - y0, seg, 1, false);
  g.translate(0, (y0 + y1) / 2, 0);
  return paint(g, hex);
}
function cone(r: number, y0: number, h: number, hex: string, seg = 16): Part {
  const g = new ConeGeometry(r, h, seg);
  g.translate(0, y0 + h / 2, 0);
  return paint(g, hex);
}
function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: string): Part {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, hex);
}
function pyramid(side: number, y0: number, h: number, hex: string): Part {
  const g = new ConeGeometry(side / Math.SQRT2, h, 4);
  g.rotateY(Math.PI / 4);
  g.translate(0, y0 + h / 2, 0);
  return paint(g, hex);
}

/**
 * Factory chimney: tapered concrete shaft, dark rim; above 100 m the obstacle marking (red and
 * white bands on the top third), as on the tall stacks of Polish power plants.
 */
export function chimneyParts(r: number, h: number): Part[] {
  const top = Math.max(0.6, r * 0.55);
  const at = (y: number) => r + (top - r) * (y / h);
  const parts: Part[] = [];
  if (h >= 100) {
    const y0 = (h * 2) / 3;
    parts.push(cyl(r, at(y0), 0, y0, C.concrete));
    const n = 7;
    const step = (h - y0) / n;
    for (let i = 0; i < n; i++) {
      const a = y0 + i * step;
      parts.push(cyl(at(a), at(a + step), a, a + step, i % 2 ? C.white : C.red));
    }
  } else {
    parts.push(cyl(r, top, 0, h - 0.8, C.concrete));
    parts.push(cyl(top, top, h - 0.8, h, C.concreteDark));
  }
  parts.push(cyl(top * 0.82, top * 0.82, h - 0.5, h + 0.05, C.soot));
  return parts;
}

/** Water tower: shaft to 70 % of the height, a wider tank above it, a low conical roof. */
export function waterTowerParts(r: number, h: number): Part[] {
  const shaftTop = h * 0.68;
  const tankTop = h * 0.93;
  return [
    cyl(r * 0.55, r * 0.5, 0, shaftTop, C.concrete),
    cyl(r * 0.5, r, shaftTop, shaftTop + 1.2, C.concreteDark),
    cyl(r, r, shaftTop + 1.2, tankTop, C.tank),
    cone(r * 1.04, tankTop, h - tankTop, C.concreteDark),
  ];
}

/** Silo: concrete cylinder with a shallow cone. */
export function siloParts(r: number, h: number): Part[] {
  return [cyl(r, r, 0, h, C.tank), cone(r, h, Math.max(0.8, r * 0.35), C.concreteDark)];
}

/**
 * Wooden belfry (St Florian's, post-and-beam, square plan): boarded lower part, open bell storey
 * on four corner posts, pyramid roof with a small cap.
 */
export function belfryParts(r: number, h: number): Part[] {
  const s = r * 1.3;
  const lower = h * 0.55;
  const bells = h * 0.78;
  const post = 0.35;
  const parts: Part[] = [box(s, lower, s, 0, lower / 2, 0, C.wood)];
  parts.push(box(s * 1.12, 0.3, s * 1.12, 0, lower + 0.15, 0, C.woodDark));
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const)
    parts.push(
      box(
        post,
        bells - lower,
        post,
        (x * (s - post)) / 2,
        (lower + bells) / 2,
        (z * (s - post)) / 2,
        C.woodDark,
      ),
    );
  parts.push(box(s * 0.25, 0.9, s * 0.25, 0, bells - 1.4, 0, C.soot)); // bell
  parts.push(pyramid(s * 1.25, bells, h - bells - 0.6, C.shingle));
  parts.push(cyl(0.35, 0.05, h - 0.9, h, C.woodDark, 8));
  return parts;
}

/**
 * Ty2 freight engine with its tender (preserved, black with red wheels), long axis along +x,
 * centred on the origin: boiler, smokebox and chimney at the front, cab, tender, 5 coupled axles.
 */
export function steamEngineParts(): Part[] {
  const L = ENGINE_HALF * 2;
  const W = ENGINE_HALF_W * 2;
  const x0 = -ENGINE_HALF;
  const parts: Part[] = [];
  // Track under it (on a plinth by the platform).
  parts.push(box(L + 1, 0.25, 2.6, 0, 0.125, 0, C.rail));
  // Frame.
  parts.push(box(L - 0.6, 0.5, W * 0.7, 0, 1.35, 0, C.black));
  // Coupled wheels (engine, front part) and tender wheels.
  const wheel = (x: number, rad: number) => {
    for (const z of [-0.78, 0.78]) {
      const g = new CylinderGeometry(rad, rad, 0.16, 14);
      g.rotateX(Math.PI / 2);
      g.translate(x, rad, z);
      parts.push(paint(g, C.wheelRed));
    }
  };
  const eng = 13.5;
  for (let i = 0; i < 5; i++) wheel(x0 + 2.2 + i * 1.6, 0.72);
  wheel(x0 + 0.9, 0.45);
  for (let i = 0; i < 4; i++) wheel(x0 + eng + 1.4 + i * 1.8, 0.5);
  // Boiler (horizontal cylinder) with smokebox, chimney and domes.
  const boiler = new CylinderGeometry(0.95, 0.95, 9.2, 16);
  boiler.rotateZ(Math.PI / 2);
  boiler.translate(x0 + 0.6 + 4.6 + 0.6, 2.75, 0);
  parts.push(paint(boiler, C.black));
  const smoke = new CylinderGeometry(1.0, 1.0, 1.2, 16);
  smoke.rotateZ(Math.PI / 2);
  smoke.translate(x0 + 0.9, 2.75, 0);
  parts.push(paint(smoke, C.soot));
  parts.push(cylAt(x0 + 1.1, 3.6, 0.32, 0.36, 0.9, C.black));
  parts.push(cylAt(x0 + 4.6, 3.6, 0.45, 0.5, 0.55, C.black));
  parts.push(cylAt(x0 + 7.0, 3.6, 0.42, 0.48, 0.5, C.black));
  // Cab.
  parts.push(box(2.6, 2.7, W, x0 + eng - 1.7, 3.1, 0, C.black));
  parts.push(box(3.0, 0.2, W * 1.08, x0 + eng - 1.7, 4.55, 0, C.soot));
  // Tender.
  parts.push(box(L - eng - 0.4, 2.6, W * 0.96, x0 + eng + (L - eng) / 2, 2.6, 0, C.black));
  parts.push(box(L - eng - 1.2, 0.3, W * 0.8, x0 + eng + (L - eng) / 2, 4.0, 0, C.soot));
  // Buffer beam.
  parts.push(box(0.25, 0.5, W, x0 + 0.15, 1.35, 0, C.wheelRed));
  return parts;
}
function cylAt(x: number, y: number, r1: number, r0: number, h: number, hex: string): Part {
  const g = new CylinderGeometry(r1, r0, h, 12);
  g.translate(x, y + h / 2, 0);
  return paint(g, hex);
}

/** Parts of one mark in its local frame (origin on the ground at its centre). */
export function markParts(k: GenMark): Part[] {
  switch (k.kind) {
    case 'chimney':
      return chimneyParts(k.r, k.h);
    case 'water-tower':
      return waterTowerParts(k.r, k.h);
    case 'silo':
      return siloParts(k.r, k.h);
    case 'bell-tower':
      return belfryParts(k.r, k.h);
    case 'steam-engine':
      return steamEngineParts();
  }
}

/** One merged geometry of the marks of a chunk, in world coordinates (three x, y, z = world x, up, world y). */
export function marksGeometry(marks: readonly GenMark[]): BufferGeometry | undefined {
  const all: Part[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const Y = new Vector3(0, 1, 0);
  for (const k of marks) {
    // World (x, y) → three (x, z); a long axis (cos, sin) in world x, y is −rot about three's Y.
    q.setFromAxisAngle(Y, -(k.rot ?? 0));
    m.compose(new Vector3(k.x, 0, k.y), q, new Vector3(1, 1, 1));
    for (const p of markParts(k)) all.push(p.applyMatrix4(m));
  }
  if (!all.length) return undefined;
  const geo = mergeGeometries(all, false);
  for (const p of all) p.dispose();
  if (!geo) return undefined;
  geo.computeBoundingSphere();
  return geo;
}

export class MarkLayer {
  readonly root = new Group();
  private readonly chunks = new Map<string, Mesh>();
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  });

  constructor() {
    this.root.name = 'landmarks';
    this.material.name = 'landmarks';
  }

  loadChunk(cx: number, cy: number, marks: readonly GenMark[] | undefined): void {
    this.unloadChunk(cx, cy);
    if (!marks?.length) return;
    const geo = marksGeometry(marks);
    if (!geo) return;
    const mesh = new Mesh(geo, this.material);
    mesh.name = `landmarks:${cx},${cy}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.chunks.set(`${cx},${cy}`, mesh);
  }

  unloadChunk(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const mesh = this.chunks.get(key);
    if (!mesh) return;
    this.root.remove(mesh);
    mesh.geometry.dispose();
    this.chunks.delete(key);
  }
}
