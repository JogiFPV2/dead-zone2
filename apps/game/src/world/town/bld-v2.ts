/**
 * Buildings v2 (`?bld=v2`): every building gets its own wall and roof colour, stable by building
 * id. Client render only. Flip `BLD_V2_DEFAULT` to make v2 the default look (`?bld=v1` still
 * gives the old one).
 *
 * Colours: OSM `building:colour` / `roof:colour` do not reach the client (the OSM converter in
 * tools/map keeps no colour tags; `GenBuildingMeta` has none), so every building draws from the
 * placeholder palette below, hashed by building id. Placeholder until the Designer's palette:
 * replace the hex values here, nothing else needs to change.
 */
export const BLD_V2_DEFAULT = false;

/** Muted Polish-town plasters (sRGB): sand, ochre, grey-green, salmon, pale blocks… (12). */
export const V2_WALLS: readonly string[] = [
  '#a59a83',
  '#b09c78',
  '#969889',
  '#8d9799',
  '#a68d77',
  '#b4ad9c',
  '#808a77',
  '#977f62',
  '#a2906b',
  '#8b817b',
  '#94a08f',
  '#ad9389',
];

/** Roofs (8): tile red, terracotta, graphite felt, dark green, brown-grey, concrete, slate. */
export const V2_ROOFS: readonly string[] = [
  '#6b3d30',
  '#7f4a33',
  '#45474a',
  '#3e4a3f',
  '#5a5048',
  '#6a675f',
  '#3d4656',
  '#8a5a3c',
];

/** Darker wall cell (shaded side / plinth of the plaster modules), like the catalogue skins. */
export const V2_DARK = 0.82;

/**
 * Free cells of the 16 × 16 palette atlas: 181–191 (after the kit's cells) and 234–255 (after
 * the catalogue cells, `skins.ts` EXT_BASE 192 + 42). 12 walls × 2 + 8 roofs = 32 of 33.
 */
export const V2_ATLAS_SLOTS: readonly number[] = [
  ...Array.from({ length: 11 }, (_, i) => 181 + i),
  ...Array.from({ length: 22 }, (_, i) => 234 + i),
];

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

type WallIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
/** One skin per wall colour (`V2_WALLS` has exactly 12, enforced by the type). */
export type V2Skin = `v2w${WallIdx}`;
export const V2_SKINS: readonly V2Skin[] = V2_WALLS.map((_, i): V2Skin => `v2w${i as WallIdx}`);

/** Stable hash in [0, 1) of a building id and a salt. */
export function bldHash(id: number, salt: number): number {
  let h = Math.imul(id | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const v2WallSkin = (building: number): V2Skin =>
  V2_SKINS[Math.floor(bldHash(building, 1) * V2_SKINS.length)]!;
export const v2RoofCell = (building: number): string =>
  `v2r${Math.floor(bldHash(building, 2) * V2_ROOFS.length)}`;

function darken(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) =>
    Math.round(((n >> s) & 255) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

/** Atlas cells of v2: [name, hex, atlas index]. */
export const V2_CELLS: readonly (readonly [string, string, number])[] = (() => {
  const out: [string, string, number][] = [];
  let k = 0;
  V2_WALLS.forEach((hex, i) => {
    out.push([`v2w${i}-wall`, hex, V2_ATLAS_SLOTS[k++]!]);
    out.push([`v2w${i}-dark`, darken(hex, V2_DARK), V2_ATLAS_SLOTS[k++]!]);
  });
  V2_ROOFS.forEach((hex, i) => out.push([`v2r${i}`, hex, V2_ATLAS_SLOTS[k++]!]));
  return out;
})();

/** Skins v2 replaces (generic siding / plaster); brick and catalogue skins keep their look. */
export const V2_REPLACES: ReadonlySet<string> = new Set(['green', 'beige', 'blue', 'plaster']);
