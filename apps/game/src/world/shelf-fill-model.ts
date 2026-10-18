/**
 * Furniture fill (deadzone-loot-spec §3): generic props on shelf slots show how full a storage
 * is. Pure layout / counting; the meshes live in `shelf-fill.ts`.
 */

import { footprintCenter, type Footprint } from '@deadzone/content/footprint';

export type PropKind = 'can' | 'box' | 'bottle' | 'jar' | 'carton' | 'books';
export const PROP_KINDS: readonly PropKind[] = ['can', 'box', 'bottle', 'jar', 'carton', 'books'];

export interface ShelfProfile {
  /** Footprint like the map-object box [w, h, d] (world units). */
  readonly size: readonly [number, number, number];
  /** Shelf heights as fractions of h (props stand on them). */
  readonly shelves: readonly number[];
  /** Slots across the width per shelf. */
  readonly cols: number;
  /** Rows in depth per shelf. */
  readonly rows: number;
  /** Prop mix (weights) when the contents are unknown. */
  readonly mix: Readonly<Partial<Record<PropKind, number>>>;
  /** Open furniture shows props always; closed only while its loot panel is open (x-ray). */
  readonly open: boolean;
  /** Prop size multiplier (default 1): big open shelving needs bigger props to read as full. */
  readonly propScale?: number;
  /**
   * Local z of the shelf depth centre (default 0 = tile centre). Real-scale models stand with
   * their back to the wall (-z), so their shelves are not centred on the tile.
   */
  readonly depthOffset?: number;
}

/** Shelf furniture by content id (crates and chests have no shelves). */
export const SHELF_PROFILES: Readonly<Record<string, ShelfProfile>> = {
  'base:kitchen-cabinet': {
    size: [0.9, 0.9, 0.6],
    shelves: [0.12, 0.55],
    cols: 6,
    rows: 1,
    mix: { can: 3, box: 2, jar: 2 },
    open: false,
  },
  'base:kitchen-counter': {
    size: [0.95, 0.9, 0.6],
    shelves: [0.12, 0.55],
    cols: 6,
    rows: 1,
    mix: { can: 3, box: 2, jar: 2 },
    open: false,
  },
  'base:fridge': {
    size: [0.75, 1.8, 0.7],
    shelves: [0.08, 0.36, 0.64],
    cols: 2,
    rows: 2,
    mix: { bottle: 3, carton: 2, jar: 2, can: 1 },
    open: false,
  },
  'base:freezer': {
    size: [0.9, 0.9, 0.7],
    shelves: [0.12, 0.5],
    cols: 3,
    rows: 2,
    mix: { box: 3, carton: 1 },
    open: false,
  },
  'base:bookshelf': {
    size: [0.95, 1.9, 0.35],
    shelves: [0.05, 0.37, 0.69],
    cols: 6,
    rows: 1,
    mix: { books: 5, box: 1 },
    open: true,
  },
  'base:metal-shelf': {
    // Designer's real-scale rack (deadzone-furniture/metal-shelf, 180×40×180 cm, 5 shelves,
    // footprint 2×1): laid out for its real width around `shelfOrigin` (= `footprintCenter`
    // with footprints on, where the model stands 1:1). Shelf tops at 0.044 / 0.28 / 0.51 /
    // 0.74 / 0.98 of the height; depth centre −0.29 (back to the wall at −z). With footprints
    // off the model is squeezed into one tile, so is the layout (`layoutProfile`).
    size: [1.8, 1.8, 0.4],
    shelves: [0.044, 0.28, 0.51, 0.74, 0.98],
    cols: 10,
    rows: 1,
    mix: { box: 3, can: 2, bottle: 1 },
    open: true,
    propScale: 1.3,
    depthOffset: -0.29,
  },
  'base:wardrobe': {
    size: [0.95, 1.9, 0.6],
    shelves: [0.05, 0.6],
    cols: 4,
    rows: 1,
    mix: { box: 3, carton: 1 },
    open: false,
  },
  'base:dresser': {
    size: [0.9, 1.0, 0.5],
    shelves: [0.1, 0.5],
    cols: 4,
    rows: 1,
    mix: { box: 2, books: 1, jar: 1 },
    open: false,
  },
  'base:locker': {
    size: [0.5, 1.8, 0.5],
    shelves: [0.05, 0.5],
    cols: 2,
    rows: 1,
    mix: { box: 2, bottle: 1 },
    open: false,
  },
  'base:gun-locker': {
    size: [0.8, 1.8, 0.5],
    shelves: [0.05, 0.5],
    cols: 3,
    rows: 1,
    mix: { box: 3 },
    open: false,
  },
};

/**
 * Tile-space point the shelf slots are laid out around (props rotate with the furniture about it).
 * Footprints off (`fp` undefined): the anchor tile centre, as always. On: the footprint centre
 * (`footprintCenter`, Modules), the same point `MapObjects` puts the model on, so a 2×1 shelf's
 * props sit on its model instead of on the anchor tile.
 */
export function shelfOrigin(
  tx: number,
  ty: number,
  rot: number,
  fp?: Footprint,
): { x: number; y: number } {
  return fp ? footprintCenter(tx, ty, rot, fp) : { x: tx + 0.5, y: ty + 0.5 };
}

/** Width a real-scale model is squeezed to with footprints off (`fitTileRealScale`). */
export const TILE_FIT_WIDTH = 0.96;

/**
 * Profile the slots are laid out with. Footprints on: as given (real width, the model is 1:1 at
 * `shelfOrigin`). Off: a profile wider than one tile is squeezed like its model
 * (`fitTileRealScale`: width → 0.96, depth and heights kept), with fewer columns so the props
 * keep their spacing. Never more slots than `slotCount(p)` (the instance capacity).
 */
export function layoutProfile(p: ShelfProfile, footprintsOn: boolean): ShelfProfile {
  const [w, h, d] = p.size;
  if (footprintsOn || w <= TILE_FIT_WIDTH) return p;
  return {
    ...p,
    size: [TILE_FIT_WIDTH, h, d],
    cols: Math.max(1, Math.round((p.cols * TILE_FIT_WIDTH) / w)),
  };
}

export function slotCount(p: ShelfProfile): number {
  return p.shelves.length * p.cols * p.rows;
}

/**
 * Props shown for a fill 0..1: 0 only when empty, otherwise at least 1, rounded up, clamped.
 * (Spec: ceil(items / capacity × slots); the sim gives fill as `fillPct`.)
 */
export function visibleProps(fillPct: number, slots: number): number {
  if (!(fillPct > 0)) return 0;
  return Math.min(slots, Math.max(1, Math.ceil(fillPct * slots - 1e-9)));
}

/**
 * Fill shown on the shelf (0..1). The sim's `fillPct` is contents weight / capacity, and the
 * demo loot (1–3 light items in a 25–70 kg cabinet) lands at 0–0.15, so shelves read empty.
 * Like PZ, unsearched storage is dressed: at least `DRESSING_MIN..MAX` (stable per id). After a
 * search the real fill shows on a perceptual curve (a few items already fill a third of it).
 */
export const DRESSING_MIN = 0.6;
export const DRESSING_MAX = 0.95;

export function displayFill(fillPct: number, searched: boolean, id: number): number {
  const real = fillPct > 0 ? Math.min(1, 0.3 + 2.8 * fillPct) : 0;
  if (searched) return real;
  const dressing = DRESSING_MIN + ((hashId(id) % 1000) / 999) * (DRESSING_MAX - DRESSING_MIN);
  return Math.max(real, dressing);
}

/** 32-bit hash of a container id (FNV-1a over the decimal string). */
export function hashId(id: number): number {
  let h = 0x811c9dc5;
  for (const ch of String(id)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 stream. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PropSlot {
  /** Local position (furniture frame, base at y = 0). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rot: number;
  readonly kind: PropKind;
}

/**
 * Slots in fill order: a fixed seeded permutation, so the first `visible` are shown and taking
 * an item removes the last shown one without reshuffling. Kind and jitter (±3 cm, ±10°) are
 * seeded per slot too.
 */
export function propSlots(p: ShelfProfile, seed: number): PropSlot[] {
  const [w, h, d] = p.size;
  const r = rng(seed);
  const base: { x: number; y: number; z: number }[] = [];
  const usableW = w * 0.78;
  const usableD = d * 0.5;
  for (const sy of p.shelves) {
    for (let row = 0; row < p.rows; row++) {
      for (let c = 0; c < p.cols; c++) {
        base.push({
          x: -usableW / 2 + (usableW * (c + 0.5)) / p.cols,
          y: sy * h,
          z:
            (p.depthOffset ?? 0) +
            (p.rows === 1 ? 0 : -usableD / 2 + (usableD * (row + 0.5)) / p.rows),
        });
      }
    }
  }
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [base[i], base[j]] = [base[j]!, base[i]!];
  }
  const kinds = PROP_KINDS.filter((k) => (p.mix[k] ?? 0) > 0);
  const total = kinds.reduce((s, k) => s + (p.mix[k] ?? 0), 0);
  return base.map((b) => {
    let pick = r() * total;
    let kind: PropKind = kinds[0] ?? 'box';
    for (const k of kinds) {
      pick -= p.mix[k] ?? 0;
      if (pick <= 0) {
        kind = k;
        break;
      }
    }
    return {
      x: b.x + (r() - 0.5) * 0.06,
      y: b.y,
      z: b.z + (r() - 0.5) * 0.06,
      rot: (r() - 0.5) * ((20 * Math.PI) / 180),
      kind,
    };
  });
}
