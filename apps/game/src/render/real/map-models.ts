/**
 * Where Designer's PBR models stand on the map in the realistic style (pure, no three.js):
 * generator buildings → blocks / houses, dumpsters → bin shelters, scrub zones → bushes.
 * World metres (1 tile = 1 m; sim x → world X, sim y → world Z, `sim/coords.ts`).
 */
import type { RealQuality } from './options.js';

/** Storey height of the town kit (`world/instances.ts` LEVEL_HEIGHT), mirrored to stay pure. */
const STOREY_M = 3;

/** One copy of a model: centre of its body on the ground, yaw and per-axis scale. */
export interface ModelPlacement {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly rotY: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
}

/**
 * Body of a building model (walls without balconies, eaves or porch steps; model metres from its
 * pivot at a base corner), storeys and their height (`assets-src/ASSETS.md`, `*.attach.json`).
 */
export interface BuildingModelSpec {
  readonly id: string;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly storeys: number;
  readonly storeyM: number;
  /** Generator storey counts the model stands for (more stretch than this looks wrong). */
  readonly floors: readonly [number, number];
  /** Long buildings repeat the model along their length (segments of a block of flats). */
  readonly repeat: boolean;
}

export const BUILDING_MODELS: Readonly<Record<string, BuildingModelSpec>> = {
  // P+4, 4 klatki, 57,6 × 12 m (balconies to z −1,1, canopies to z 13,6).
  'blok-p4': {
    id: 'blok-p4',
    x0: 0,
    x1: 57.6,
    z0: 0,
    z1: 12,
    storeys: 5,
    storeyM: 3.3,
    floors: [4, 7],
    repeat: true,
  },
  // P+10, 2 klatki, 28,8 × 13 m.
  'blok-p10': {
    id: 'blok-p10',
    x0: 0,
    x1: 28.8,
    z0: 0,
    z1: 13,
    storeys: 11,
    storeyM: 3.1,
    floors: [8, 13],
    repeat: true,
  },
  // Two storeys (fh 2,8) + attic, house 11 × 9 m with the garage annex to x 14,2.
  'dom-90': {
    id: 'dom-90',
    x0: 0,
    x1: 14.2,
    z0: 0,
    z1: 9.4,
    storeys: 2,
    storeyM: 2.8,
    floors: [1, 3],
    repeat: false,
  },
  // „Kostka” with a hip roof, 9,4 × 9,4 m, two storeys (fh 2,8).
  'dom-kostka-namiot': {
    id: 'dom-kostka-namiot',
    x0: 0,
    x1: 9.4,
    z0: 0,
    z1: 9.4,
    storeys: 2,
    storeyM: 2.8,
    floors: [1, 3],
    repeat: false,
  },
};

/** Horizontal stretch a model may take before the kit building stays instead. */
export const STRETCH: readonly [number, number] = [0.65, 1.5];
/**
 * The model's walls sit this far inside the tile footprint: the kit's door leaves (sim doors,
 * drawn on the wall line) stay in front of the facade instead of inside it.
 */
export const SHELL_INSET_M = 0.12;

/** Generator building as the client sees it (`GenBuildingInfo`, global tiles, inclusive). */
export interface BuildingInfo {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly floors: number;
  readonly rect: boolean;
  readonly kind?: string;
  readonly outline?: readonly number[];
}

/** Candidate models per generator kind, in order of preference. */
const KIND_MODELS: Readonly<Record<string, readonly string[]>> = {
  block: ['blok-p4', 'blok-p10'],
  house: ['dom-90', 'dom-kostka-namiot'],
  kostka: ['dom-kostka-namiot', 'dom-90'],
};

const within = (v: number, [lo, hi]: readonly [number, number]): boolean => v >= lo && v <= hi;

/** Small stable hash of a building id (front side choice). */
const hash = (n: number): number => (Math.imul(n | 0, 2654435761) >>> 0) / 4294967296;

/**
 * The model copies standing in for a building, or undefined (the kit building stays): only
 * rectangular blocks / houses whose size and storeys a model fits within `STRETCH`.
 */
export function buildingPlacements(b: BuildingInfo): ModelPlacement[] | undefined {
  if (!b.rect || b.outline) return undefined;
  const ids = KIND_MODELS[b.kind ?? ''];
  if (!ids) return undefined;
  const w = b.x1 - b.x0 + 1 - 2 * SHELL_INSET_M;
  const d = b.y1 - b.y0 + 1 - 2 * SHELL_INSET_M;
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  const alongX = w >= d;
  const cx = (b.x0 + b.x1 + 1) / 2;
  const cz = (b.y0 + b.y1 + 1) / 2;
  for (const id of ids) {
    const m = BUILDING_MODELS[id]!;
    if (!within(b.floors, m.floors)) continue;
    const bodyL = m.x1 - m.x0;
    const bodyD = m.z1 - m.z0;
    const n = m.repeat ? Math.max(1, Math.round(long / bodyL)) : 1;
    const sx = long / (n * bodyL);
    const sz = short / bodyD;
    if (!within(sx, STRETCH) || !within(sz, STRETCH)) continue;
    const sy = (b.floors * STOREY_M) / (m.storeys * m.storeyM);
    // Model +x along the long side; the front (model −z, balconies / entrances) faces one way
    // or the other by the building id.
    const flip = hash(b.id) < 0.5 ? 0 : Math.PI;
    const rotY = (alongX ? 0 : -Math.PI / 2) + flip;
    const seg = long / n;
    const out: ModelPlacement[] = [];
    for (let i = 0; i < n; i++) {
      const off = -long / 2 + seg * (i + 0.5);
      out.push({
        id,
        x: alongX ? cx + off : cx,
        z: alongX ? cz : cz + off,
        rotY,
        sx,
        sy,
        sz,
      });
    }
    return out;
  }
  return undefined;
}

/** A map object of a chunk (global tile, rotation 0–3). */
export interface TileObject {
  readonly contentId: string;
  readonly tx: number;
  readonly ty: number;
  readonly rot: number;
}

export const DUMPSTER = 'base:dumpster';
/** Bin shelter model and its size (5 × 1100 l, 6,4 × 2,7 m, pivot at a base corner). */
export const SHELTER = { id: 'smietnik', x0: -0.15, x1: 6.55, z0: -0.15, z1: 2.85 } as const;
/** A lone dumpster gets a smaller shelter (two to three bins wide). */
export const SHELTER_SINGLE_SCALE = 0.6;

/**
 * Bin shelters over dumpsters: 4-neighbour groups of dumpsters (the generator puts a pair by a
 * block of flats) get one full-size shelter along the group, a lone dumpster a smaller one
 * turned like the object (its back to the wall).
 */
export function shelterPlacements(objects: readonly TileObject[]): ModelPlacement[] {
  const tiles = objects.filter((o) => o.contentId === DUMPSTER);
  const key = (x: number, y: number) => `${x},${y}`;
  const byTile = new Map(tiles.map((o) => [key(o.tx, o.ty), o]));
  const seen = new Set<string>();
  const out: ModelPlacement[] = [];
  for (const start of tiles) {
    const k0 = key(start.tx, start.ty);
    if (seen.has(k0)) continue;
    const group: TileObject[] = [];
    const todo = [start];
    seen.add(k0);
    while (todo.length) {
      const o = todo.pop()!;
      group.push(o);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const k = key(o.tx + dx, o.ty + dy);
        const n = byTile.get(k);
        if (n && !seen.has(k)) {
          seen.add(k);
          todo.push(n);
        }
      }
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const o of group) {
      x0 = Math.min(x0, o.tx);
      x1 = Math.max(x1, o.tx + 1);
      y0 = Math.min(y0, o.ty);
      y1 = Math.max(y1, o.ty + 1);
    }
    const single = group.length === 1;
    const s = single ? SHELTER_SINGLE_SCALE : 1;
    // Object rot 0 = back to the north wall; the shelter's back wall is its model +z side.
    const rotY = single
      ? (-start.rot * Math.PI) / 2 + Math.PI
      : x1 - x0 >= y1 - y0
        ? 0
        : -Math.PI / 2;
    out.push({ id: SHELTER.id, x: (x0 + x1) / 2, z: (y0 + y1) / 2, rotY, sx: s, sy: s, sz: s });
  }
  return out;
}

/** Bush model (`krzak`, ~1,9 m across, 1 m tall). */
export const BUSH = 'krzak';

/** Bushes per tile of a scrub zone, per quality preset (fewer on low). */
export const BUSH_DENSITY: Readonly<Record<RealQuality, number>> = {
  low: 0.05,
  medium: 0.1,
  high: 0.14,
};
/** Most bushes one chunk may hold (instancing budget). */
export const BUSH_MAX_PER_CHUNK = 160;

/** Deterministic 0..1 per tile and salt. */
export function tileHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Bushes in scrub / hedge zones (`bushes` cover rects, global tiles) of one chunk. */
export function bushPlacements(
  rects: readonly { x: number; y: number; w: number; h: number }[],
  quality: RealQuality,
): ModelPlacement[] {
  const density = BUSH_DENSITY[quality];
  const out: ModelPlacement[] = [];
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (out.length >= BUSH_MAX_PER_CHUNK) return out;
        if (tileHash(x, y, 1) >= density) continue;
        const s = 0.7 + tileHash(x, y, 2) * 0.5;
        out.push({
          id: BUSH,
          x: x + 0.2 + tileHash(x, y, 3) * 0.6,
          z: y + 0.2 + tileHash(x, y, 4) * 0.6,
          rotY: tileHash(x, y, 5) * Math.PI * 2,
          sx: s,
          sy: s,
          sz: s,
        });
      }
  }
  return out;
}

/** Model body centre (pivot-relative) used to centre a placement: buildings and the shelter. */
export function bodyCentre(id: string): { x: number; z: number } {
  const m = BUILDING_MODELS[id];
  if (m) return { x: (m.x0 + m.x1) / 2, z: (m.z0 + m.z1) / 2 };
  if (id === SHELTER.id)
    return { x: (SHELTER.x0 + SHELTER.x1) / 2, z: (SHELTER.z0 + SHELTER.z1) / 2 };
  return { x: 0, z: 0 };
}
