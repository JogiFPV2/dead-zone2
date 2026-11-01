import {
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import { LEVEL_HEIGHT } from '../instances.js';
import { DETAIL_CARD, type DetailCard } from './window-card.js';

/**
 * bld detail (look-spec §D, behind `?bld-detail=1`, default off): signs, police stripe, school
 * bands, hospital cross, roof holes, graffiti and plaster loss as quads of ONE InstancedMesh on
 * the window-card material (same atlas, no new material): +1 draw call whatever the count.
 * Broken / boarded windows reuse the window panes (`detailWindowCell`).
 */
let enabled = false;
/** `?bld-detail=1` turns the detail on (default off: the default look is unchanged). */
export function initBldDetail(search: string): boolean {
  const v = new URLSearchParams(search).get('bld-detail');
  enabled = v === '1' || v === 'true';
  return enabled;
}
export const bldDetail = (): boolean => enabled;
/** Tests. */
export function setBldDetail(on: boolean): void {
  enabled = on;
}

/** What the decals need of a building (chunk meta). */
export interface DecalBuilding {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  floors: number;
  rect?: boolean;
  look?: string | undefined;
  condition?: string | undefined;
  roofShape?: string | undefined;
}

/** look-spec §C `roofDamage` share per state → holes = ceil(roofDamage × 6). */
const ROOF_DAMAGE: Readonly<Record<string, number>> = { abandoned: 0.2, ruin: 0.6 };
/** Plaster loss patches per building (look-spec §D weathering). */
const PATCHES: Readonly<Record<string, number>> = { abandoned: 3, ruin: 5 };
/** Window state of abandoned / ruin buildings: [broken, boarded] shares (look-spec §C). */
const WINDOWS: Readonly<Record<string, readonly [number, number]>> = {
  abandoned: [0.5, 0.3],
  ruin: [0.9, 0.1],
};

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Window card of a window of a building in `condition` (flag on): broken / boarded cell and no
 * glass, else undefined (keep the interior card and the glass).
 */
export function detailWindowCell(
  condition: string | undefined,
  building: number,
  seed: number,
): number | undefined {
  const w = condition ? WINDOWS[condition] : undefined;
  if (!enabled || !w) return undefined;
  const r = hash(building, seed);
  if (r < w[0]) return r < w[0] / 2 ? DETAIL_CARD.broken : DETAIL_CARD.broken2;
  if (r < w[0] + w[1]) return r < w[0] + w[1] / 2 ? DETAIL_CARD.boarded : DETAIL_CARD.boarded2;
  return undefined;
}

/** One decal: atlas cell, centre (three x / y / z), facing (rot about Y; flat = on a roof), size. */
export interface Decal {
  cell: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  flat: boolean;
  w: number;
  h: number;
}

/** Wall offset: decals sit this far out of the footprint edge (walls are drawn on tile edges). */
const OUT = 0.16;
const FLAT_ROOFS = new Set(['flat', undefined]);

/** Decals of a building (rect footprints only: the bbox faces are the walls). */
export function buildingDecals(b: DecalBuilding): Decal[] {
  if (!b.rect) return [];
  const out: Decal[] = [];
  const floors = Math.max(1, b.floors);
  const top = floors * LEVEL_HEIGHT;
  // The bbox is inclusive (tiles): the E / S walls are on the far edge of the last tile.
  const x1 = b.x1 + 1;
  const y1 = b.y1 + 1;
  const w = x1 - b.x0;
  const d = y1 - b.y0;
  // Faces: N (z = y0, facing −z), S (z = y1 + 1, +z), W (x = x0, −x), E (x = x1 + 1, +x).
  const faces = [
    { len: w, at: (t: number) => [b.x0 + t * w, b.y0 - OUT] as const, rot: Math.PI },
    { len: w, at: (t: number) => [b.x0 + t * w, y1 + OUT] as const, rot: 0 },
    { len: d, at: (t: number) => [b.x0 - OUT, b.y0 + t * d] as const, rot: -Math.PI / 2 },
    { len: d, at: (t: number) => [x1 + OUT, b.y0 + t * d] as const, rot: Math.PI / 2 },
  ];
  const put = (f: number, t: number, y: number, cell: number, ww: number, hh: number) => {
    const face = faces[f]!;
    const [x, z] = face.at(t);
    out.push({ cell, x, y, z, rotY: face.rot, flat: false, w: Math.min(ww, face.len), h: hh });
  };
  // Main facade: the longer side towards south (+z), else north.
  const main = w >= d ? 1 : 3;
  const signY = Math.min(top - 0.6, LEVEL_HEIGHT - 0.35);
  if (b.look === 'school') {
    put(main, 0.5, signY, DETAIL_CARD.signSchool, 4, 1.2);
    // Under-window bands on every floor of the long sides.
    for (let z = 0; z < floors; z++)
      for (const f of w >= d ? [0, 1] : [2, 3])
        put(f, 0.5, z * LEVEL_HEIGHT + 0.85, DETAIL_CARD.bandSchool, faces[f]!.len - 0.4, 0.3);
  } else if (b.look === 'police') {
    put(main, 0.38, signY, DETAIL_CARD.signPolice, 4, 1.2);
    put(main, 0.68, signY, DETAIL_CARD.star, 0.9, 0.9);
    for (let f = 0; f < 4; f++)
      put(f, 0.5, LEVEL_HEIGHT - 0.2, DETAIL_CARD.stripePolice, faces[f]!.len - 0.2, 0.35);
  } else if (b.look === 'hospital') {
    put(main, 0.4, top - 1.2, DETAIL_CARD.signHospital, 5, 1.5);
    put(main, 0.75, top - 1.2, DETAIL_CARD.cross, 1.4, 1.4);
    put(main === 1 ? 0 : 2, 0.3, signY, DETAIL_CARD.signSor, 2.4, 0.9);
  }
  const c = b.condition;
  const patches = c ? (PATCHES[c] ?? 0) : 0;
  for (let i = 0; i < patches; i++) {
    const f = Math.floor(hash(b.id, 40 + i) * 4);
    const y = 0.8 + hash(b.id, 50 + i) * (top - 1.6);
    put(f, 0.15 + hash(b.id, 60 + i) * 0.7, y, DETAIL_CARD.plasterLoss, 1.2, 0.9);
  }
  if (c === 'neglected' || c === 'abandoned' || c === 'ruin')
    put(main, 0.5, top - 0.9, DETAIL_CARD.streaks, Math.min(w, d, 6), 1.6);
  if (c === 'abandoned' || c === 'ruin') {
    const g = Math.floor(hash(b.id, 70) * 4);
    put(main, 0.2 + hash(b.id, 71) * 0.6, 1.0, DETAIL_CARD.graffiti0 + g, 2.2, 1.1);
    const holes = Math.ceil((ROOF_DAMAGE[c] ?? 0) * 6);
    if (FLAT_ROOFS.has(b.roofShape) && w > 3 && d > 3)
      for (let i = 0; i < holes; i++) {
        const s = 1.4 + hash(b.id, 80 + i) * 1.6;
        out.push({
          cell: i % 2 ? DETAIL_CARD.roofHole2 : DETAIL_CARD.roofHole,
          x: b.x0 + 1 + hash(b.id, 90 + i) * (w - 2),
          y: top + 0.05,
          z: b.y0 + 1 + hash(b.id, 100 + i) * (d - 2),
          rotY: hash(b.id, 110 + i) * Math.PI,
          flat: true,
          w: s,
          h: s,
        });
      }
  }
  return out;
}

const UP = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const Y = new Vector3(0, 1, 0);
const ZERO = new Matrix4().makeScale(0, 0, 0);

/** One InstancedMesh of decal quads on the window-card material (+1 draw call). */
export class BldDecals {
  readonly mesh: InstancedMesh;
  private cells: Float32Array;
  private readonly free: number[] = [];
  private used = 0;
  private readonly byKey = new Map<string, number[]>();

  constructor(material: Material, capacity = 1024) {
    const quad = new PlaneGeometry(1, 1);
    this.mesh = new InstancedMesh(quad, material, capacity);
    this.cells = new Float32Array(capacity);
    quad.setAttribute('aCell', new InstancedBufferAttribute(this.cells, 1));
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'bld-decals';
  }

  /** Decals currently placed. */
  get size(): number {
    return this.used - this.free.length;
  }

  private grow(need: number): void {
    const cap = this.cells.length;
    if (need <= cap) return;
    const next = Math.max(need, cap * 2);
    const a = new InstancedBufferAttribute(new Float32Array(next * 16), 16);
    a.array.set(this.mesh.instanceMatrix.array);
    this.mesh.instanceMatrix = a;
    const cells = new Float32Array(next);
    cells.set(this.cells);
    this.cells = cells;
    this.mesh.geometry.setAttribute('aCell', new InstancedBufferAttribute(cells, 1));
  }

  /** Places the decals of `key` (a chunk); replaces what that key had. */
  set(key: string, decals: readonly Decal[]): void {
    this.remove(key);
    if (!decals.length) return;
    const q = new Quaternion();
    const m = new Matrix4();
    const ids: number[] = [];
    for (const d of decals) {
      const i = this.free.pop() ?? this.used++;
      this.grow(i + 1);
      q.setFromAxisAngle(Y, d.rotY);
      if (d.flat) q.multiply(UP);
      m.compose(new Vector3(d.x, d.y, d.z), q, new Vector3(d.w, d.h, 1));
      this.mesh.setMatrixAt(i, m);
      this.cells[i] = d.cell;
      ids.push(i);
    }
    this.byKey.set(key, ids);
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.getAttribute('aCell').needsUpdate = true;
  }

  remove(key: string): void {
    const ids = this.byKey.get(key);
    if (!ids) return;
    for (const i of ids) {
      this.mesh.setMatrixAt(i, ZERO);
      this.free.push(i);
    }
    this.byKey.delete(key);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

export type { DetailCard };
