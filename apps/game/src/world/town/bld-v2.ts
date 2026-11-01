import { buildingLook, LOOK_PALETTE, lookType, type LookType } from '@deadzone/map/world-source';
import { BLD_PALETTE, type BldType } from './bld-palette.js';

type BuildingLookKind = Parameters<typeof buildingLook>[0]['b']['kind'];

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
export const BLD_V2_DEFAULT = true;

/** Estate grid for blocks of flats (tiles = metres). */
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

export { ESTATE_CELL, PUBLIC_MIN_AREA } from '@deadzone/map/world-source';

/** Generator look type (`@deadzone/map` `LookType`) → client atlas type. */
function toBld(t: LookType | undefined): BldType | undefined {
  if (t === 'school' || t === 'police' || t === 'hospital') return 'public';
  if (t === 'barn') return 'outbuilding';
  return t;
}

/** Generator kind → palette type; undefined = keep the v1 look (ruins, unknown). */
export function bldType(kind: string | undefined): BldType | undefined {
  return toBld(lookType(kind ?? '', 1, 0));
}

/**
 * Palette type of a building: the chunk's `look` (generator rev 21+), else the generator rule
 * (`lookType` in `@deadzone/map`) for old chunks.
 */
export function bldTypeOf(b: BldInfo): BldType | undefined {
  if (b.look) return toBld(b.look as LookType);
  return toBld(lookType(b.kind ?? '', b.floors ?? 1, Math.abs((b.x1 - b.x0) * (b.y1 - b.y0))));
}

/**
 * Atlas colours: the client palette first, then every colour of the generator palette
 * (`LOOK_PALETTE`: school, police, hospital, barn, house archetypes, flat-roof variants), cut
 * down to `n` by dropping the later colour of the closest pair (the atlas holds 66 colours).
 */
function fit(first: readonly string[], more: readonly string[], n: number): string[] {
  const all = [...new Set([...first, ...more])];
  const d = (a: string, b: string) => {
    const [r, g, bl] = rgb(a);
    const [r2, g2, b2] = rgb(b);
    return (r - r2) ** 2 + (g - g2) ** 2 + (bl - b2) ** 2;
  };
  while (all.length > n) {
    let bi = 1;
    let bd = Infinity;
    for (let i = 1; i < all.length; i++)
      for (let j = 0; j < i; j++) {
        const v = d(all[i]!, all[j]!);
        if (v < bd) {
          bd = v;
          bi = i;
        }
      }
    all.splice(bi, 1);
  }
  return all;
}
const LOOK = Object.values(LOOK_PALETTE);
const WALL_HEX: readonly string[] = fit(
  TYPES.flatMap((t) => BLD_PALETTE[t].walls),
  LOOK.flatMap((p) => [...p.walls, ...(p.archetypes ?? []).flatMap((a) => a.walls ?? [])]),
  37,
);
const ROOF_HEX: readonly string[] = fit(
  TYPES.flatMap((t) => BLD_PALETTE[t].roofs),
  LOOK.flatMap((p) => [...p.roofs, ...(p.archetypes ?? []).flatMap((a) => a.roofs ?? [])]),
  29,
);

type Idx<N extends number, A extends number[] = []> = A['length'] extends N
  ? A[number]
  : Idx<N, [...A, A['length']]>;
/** Wall skins: one per unique wall colour (37 in the palette; the test pins the count). */
export const V2_WALL_COUNT = 37;
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

/** Cells of v2: [name, hex, sub-cell]. Walls `v2wN-wall` / `v2wN-dark`, roofs `v2rN` / `v2rN-dark`. */
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
  // Roofs need a `-dark` twin too (shaded slope of pitched roofs: `${colour}-dark`).
  ROOF_HEX.forEach((hex, i) => {
    out.push([`v2r${i}`, hex, next()]);
    out.push([`v2r${i}-dark`, darken(hex, V2_DARK), next()]);
  });
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
  /** Floor levels (1 = bungalow); absent = unknown. */
  floors?: number | undefined;
  /** Look from the chunk data (generator rev 21+). */
  look?: string | undefined;
  wallColor?: string | undefined;
  roofColor?: string | undefined;
  /** `ok | neglected | abandoned | ruin` from the chunk data. */
  condition?: string | undefined;
}

/** look-spec §C condition colour: `lerp(c, luma(c), desaturate) * (1 - darken)`. */
const CONDITION_TINT: Readonly<Record<string, readonly [number, number]>> = {
  neglected: [0.25, 0.1],
  abandoned: [0.45, 0.18],
  ruin: [0.65, 0.3],
};
export function conditionTint(hex: string, condition: string | undefined): string {
  const t = condition ? CONDITION_TINT[condition] : undefined;
  if (!t) return hex;
  const [r, g, b] = rgb(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const c = (v: number) =>
    Math.round(Math.min(255, (v + (y - v) * t[0]) * (1 - t[1])))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
const infos = new Map<number, BldInfo>();
/** Streamed town hook: remember kind and footprint of the buildings of a chunk. */
export function noteBuildings(list: Iterable<BldInfo>): void {
  for (const b of list) infos.set(b.id, b);
}
/** Generator kind of a noted building. */
export const bldKind = (id: number): string | undefined => infos.get(id)?.kind;
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

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Index of the atlas colour nearest to `hex` (data colours outside the atlas: OSM, palette v3). */
export function nearestHex(list: readonly string[], hex: string): number {
  const [r, g, b] = rgb(hex);
  let best = 0;
  let bd = Infinity;
  list.forEach((h, i) => {
    const [r2, g2, b2] = rgb(h);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/**
 * Wall / roof colour of a building: from the chunk data (generator rev 21+, single source of
 * truth), else — old chunks only — the same generator rule (`buildingLook`) run here.
 */
function colours(b: BldInfo): { wall: string; roof: string } | undefined {
  if (b.wallColor && b.roofColor)
    return {
      wall: conditionTint(b.wallColor, b.condition),
      roof: conditionTint(b.roofColor, b.condition),
    };
  if (b.look) return undefined;
  const l = buildingLook({
    b: { id: b.id, kind: (b.kind ?? '') as BuildingLookKind },
    floors: b.floors ?? 1,
    x0: b.x0,
    y0: b.y0,
    x1: b.x1,
    y1: b.y1,
  });
  if (!l) return undefined;
  // Blocks of one estate share the atlas wall: map the pre-jitter base colour, so the ±6 % / ±4°
  // jitter cannot push neighbours across an atlas boundary.
  const base = b.kind === 'block' && l.pair.startsWith('#') ? l.pair.slice(0, 7) : undefined;
  return { wall: base ?? l.wallColor, roof: l.roofColor };
}

/** v2 wall skin of a building; undefined = keep the v1 skin (unknown building / kind). */
export function v2WallSkin(building: number): V2Skin | undefined {
  const b = infos.get(building);
  if (!b || !bldTypeOf(b)) return undefined;
  const c = colours(b);
  return c && V2_SKINS[nearestHex(WALL_HEX, c.wall)];
}

/** v2 roof cell of a building; undefined = keep the v1 roof colour. */
export function v2RoofCell(building: number): string | undefined {
  const b = infos.get(building);
  if (!b || !bldTypeOf(b)) return undefined;
  const c = colours(b);
  return c && `v2r${nearestHex(ROOF_HEX, c.roof)}`;
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
