import { BLD_PALETTE, type BldType } from './bld-palette.js';

/**
 * Buildings v2 (`?bld=v2`): every building gets a wall and roof colour from the Designer's
 * palette of its type (`bld-palette.ts`), stable by building id. Client render only. Flip
 * `BLD_V2_DEFAULT` to make v2 the default look (`?bld=v1` still gives the old one).
 *
 * Seeds: `hash(building id)` (the client has the map-global building id, not the OSM way id);
 * blocks of flats share the wall colour per estate = 150 × 150 m grid cell of the block's
 * footprint centre (the client has no landuse polygons), roofs stay per block.
 *
 * Colours live in quarter cells (sub-cells) of the free cells of the 16 × 16 palette atlas: the
 * kit paints the palette at 2× (`PALETTE_SCALE`, nearest filtering, no mipmaps), so every free
 * cell holds 4 colours and existing UVs are untouched: 33 free cells → 132 colours.
 */
export const BLD_V2_DEFAULT = false;

/** Estate grid for blocks of flats (tiles = metres). */
export const ESTATE_CELL = 150;
/** The kit paints the palette image at this scale (sub-cells need ≥ 2). */
export const PALETTE_SCALE = 2;
/** Darker wall cell (shaded side / plinth of the plaster modules). */
export const V2_DARK = 0.86;

/** Free cells of the 16 × 16 atlas: 181–191 (after the kit) and 234–255 (after `EXT_CELLS`). */
export const V2_ATLAS_SLOTS: readonly number[] = [
  ...Array.from({ length: 11 }, (_, i) => 181 + i),
  ...Array.from({ length: 22 }, (_, i) => 234 + i),
];

const TYPES = Object.keys(BLD_PALETTE) as BldType[];

/** Generator kind → palette type; undefined = keep the v1 look (ruins, unknown). */
export function bldType(kind: string | undefined): BldType | undefined {
  switch (kind) {
    case 'block':
      return 'block';
    case 'house':
      return 'house';
    case 'shop':
    case 'office':
    case 'pharmacy':
    case 'fuel':
    case 'gas':
    case 'gym':
      return 'service';
    case 'industrial':
      return 'industrial';
    case 'church':
    case 'school':
    case 'hospital':
    case 'police':
    case 'fire-station':
    case 'station':
      return 'public';
    case 'shed':
    case 'garage':
      return 'outbuilding';
    default:
      return undefined;
  }
}

/** Unique wall / roof colours over all types, in palette order. */
const WALL_HEX: readonly string[] = [...new Set(TYPES.flatMap((t) => BLD_PALETTE[t].walls))];
const ROOF_HEX: readonly string[] = [...new Set(TYPES.flatMap((t) => BLD_PALETTE[t].roofs))];

type Idx<N extends number, A extends number[] = []> = A['length'] extends N
  ? A[number]
  : Idx<N, [...A, A['length']]>;
/** Wall skins: one per unique wall colour (32 in the palette; the test pins the count). */
export const V2_WALL_COUNT = 32;
export type V2Skin = `v2w${Idx<typeof V2_WALL_COUNT>}`;
export const V2_SKINS: readonly V2Skin[] = Array.from(
  { length: V2_WALL_COUNT },
  (_, i) => `v2w${i}` as V2Skin,
);
export const V2_WALL_HEX = WALL_HEX;
export const V2_ROOF_HEX = ROOF_HEX;

function darken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) =>
    Math.round(((n >> s) & 255) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

/** Atlas sub-cell: cell index and quarter (0–3). */
export interface SubCell {
  cell: number;
  q: number;
}
/** UV centre of a sub-cell (16 × 16 grid, quarters). */
export function subCellUv(s: SubCell): [number, number] {
  return [
    ((s.cell % 16) + 0.25 + 0.5 * (s.q % 2)) / 16,
    (Math.floor(s.cell / 16) + 0.25 + 0.5 * (s.q >> 1)) / 16,
  ];
}

/** Cells of v2: [name, hex, sub-cell]. Walls `v2wN-wall` / `v2wN-dark`, roofs `v2rN`. */
export const V2_CELLS: readonly (readonly [string, string, SubCell])[] = (() => {
  const out: [string, string, SubCell][] = [];
  let k = 0;
  const next = (): SubCell => {
    const cell = V2_ATLAS_SLOTS[k >> 2];
    if (cell === undefined) throw new Error('bld v2: palette atlas full');
    return { cell, q: k++ & 3 };
  };
  V2_SKINS.forEach((s, i) => {
    const hex = WALL_HEX[i] ?? WALL_HEX[0]!;
    out.push([`${s}-wall`, hex, next()]);
    out.push([`${s}-dark`, darken(hex, V2_DARK), next()]);
  });
  ROOF_HEX.forEach((hex, i) => out.push([`v2r${i}`, hex, next()]));
  return out;
})();

/** Paints the v2 sub-cells into the (scaled) palette canvas of `size` px. */
export function paintV2Cells(
  ctx: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>,
  size: number,
): void {
  const px = size / 16;
  const h = px / 2;
  for (const [, hex, s] of V2_CELLS) {
    ctx.fillStyle = hex;
    ctx.fillRect(
      (s.cell % 16) * px + (s.q % 2) * h,
      Math.floor(s.cell / 16) * px + (s.q >> 1) * h,
      h,
      h,
    );
  }
}

let enabled = BLD_V2_DEFAULT;

/** `?bld=v2` / `?bld=v1` override the default; call before the town is built. */
export function initBldV2(search: string): boolean {
  const v = new URLSearchParams(search).get('bld');
  enabled = v === 'v2' ? true : v === 'v1' ? false : BLD_V2_DEFAULT;
  return enabled;
}
export const bldV2 = (): boolean => enabled;
/** Tests. */
export function setBldV2(on: boolean): void {
  enabled = on;
}

/** Building metadata the look needs (streamed chunks: `GenBuildingMeta`). */
export interface BldInfo {
  id: number;
  kind?: string | undefined;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const infos = new Map<number, BldInfo>();
/** Streamed town hook: remember kind and footprint of the buildings of a chunk. */
export function noteBuildings(list: Iterable<BldInfo>): void {
  for (const b of list) infos.set(b.id, b);
}
/** Tests. */
export function clearBuildings(): void {
  infos.clear();
}

/** Stable hash in [0, 1) of two ints and a salt. */
export function bldHash(a: number, b: number, salt = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(salt, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Weighted pick in [0, n) by `r` in [0, 1). */
export function weighted(weights: readonly number[], r: number): number {
  const sum = weights.reduce((a, w) => a + w, 0) || 1;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]! / sum;
    if (r < acc) return i;
  }
  return Math.max(0, weights.length - 1);
}

/** Wall-colour seed: the block's estate cell, otherwise the building. */
export function wallSeed(b: BldInfo, type: BldType): number {
  if (type !== 'block') return bldHash(b.id, 0, 1);
  const cx = Math.floor((b.x0 + b.x1) / 2 / ESTATE_CELL);
  const cy = Math.floor((b.y0 + b.y1) / 2 / ESTATE_CELL);
  return bldHash(cx, cy, 2);
}

/** v2 wall skin of a building; undefined = keep the v1 skin (unknown building / kind). */
export function v2WallSkin(building: number): V2Skin | undefined {
  const b = infos.get(building);
  const type = bldType(b?.kind);
  if (!b || !type) return undefined;
  const p = BLD_PALETTE[type];
  const hex = p.walls[weighted(p.weights, wallSeed(b, type))]!;
  return V2_SKINS[WALL_HEX.indexOf(hex)];
}

/** v2 roof cell of a building; undefined = keep the v1 roof colour. */
export function v2RoofCell(building: number): string | undefined {
  const b = infos.get(building);
  const type = bldType(b?.kind);
  if (!b || !type) return undefined;
  const roofs = BLD_PALETTE[type].roofs;
  const hex = roofs[Math.floor(bldHash(building, 0, 3) * roofs.length)]!;
  return `v2r${ROOF_HEX.indexOf(hex)}`;
}

/** Skins v2 replaces; brick and catalogue skins (hospital, school…) keep theirs. */
export const V2_REPLACES: ReadonlySet<string> = new Set([
  'green',
  'beige',
  'blue',
  'plaster',
  'shop',
  'kostka',
]);
