import { BufferAttribute, type BufferGeometry } from 'three';
import type { TownKitIndex } from './kit.js';
import { V2_CELLS, V2_SKINS } from './bld-v2.js';

/**
 * Catalogue skins of the building mockup (`deadzone-buildings-spec.md`, `palette-ext.json`):
 * the plaster modules with their wall cells swapped (no new meshes). The extra palette cells
 * live at atlas index 192+ (8 px cells of the 128 px palette), painted at load time.
 */
export const EXT_BASE = 192;
export const EXT_CELLS: readonly (readonly [string, string])[] = [
  ['hosp-wall', '#8c8d86'],
  ['hosp-dark', '#74756f'],
  ['police-wall', '#4f5a67'],
  ['police-dark', '#414a55'],
  ['school-wall', '#80704e'],
  ['school-dark', '#6a5c40'],
  ['shop-wall', '#6d7268'],
  ['shop-dark', '#5b5f57'],
  ['kostka-wall', '#6f6656'],
  ['kostka-dark', '#5b5446'],
  ['plank', '#5d4f3d'],
  ['plank-dark', '#493e30'],
  ['trim-white', '#9c9a90'],
  ['roof-tile', '#6b3d30'],
  ['roof-tile-dark', '#552f26'],
  ['roof-felt', '#2f3132'],
  ['roof-felt-dark', '#27292a'],
  ['corrugated', '#5f615c'],
  ['corrugated-dark', '#4f514c'],
  ['rust', '#6b4731'],
  ['gas-wall', '#7d817b'],
  ['gas-dark', '#676b66'],
  ['pharm-wall', '#7a7262'],
  ['pharm-dark', '#645d50'],
  ['char', '#3b3632'],
  ['char-dark', '#2c2826'],
  ['rail', '#3c4446'],
  ['water', '#2c4650'],
  // Blocks of flats (Designer's blok-p4 / blok-p10 / blok-p4-docieplony): balconies, canopies.
  ['blok-balc-a', '#7a7f84'],
  ['blok-balc-b', '#8b6a4e'],
  ['blok-balc-c', '#6c7a5c'],
  ['blok-balc-d', '#94886a'],
  ['blok-balc-e', '#5b7480'],
  ['blok-balc-f', '#8e989a'],
  ['blok-slab', '#7f7d76'],
  ['blok-canopy', '#7d7b74'],
  ['blok-joint', '#55534d'],
  ['blok-sign', '#2f5a8a'],
  ['blok-vent', '#7a776f'],
  ['blok-accent-a', '#a8704e'],
  ['blok-accent-b', '#6f8c88'],
  ['blok-accent-c', '#b59a55'],
];

/** Catalogue skin -> wall cells replacing `wall-plaster` / `wall-plaster-dark`. */
export const EXT_SKINS = {
  hospital: { main: 'hosp-wall', dark: 'hosp-dark' },
  police: { main: 'police-wall', dark: 'police-dark' },
  school: { main: 'school-wall', dark: 'school-dark' },
  shop: { main: 'shop-wall', dark: 'shop-dark' },
  kostka: { main: 'kostka-wall', dark: 'kostka-dark' },
  plank: { main: 'plank', dark: 'plank-dark' },
  gas: { main: 'gas-wall', dark: 'gas-dark' },
  pharmacy: { main: 'pharm-wall', dark: 'pharm-dark' },
  burnt: { main: 'char', dark: 'char-dark' },
} as const;
export type ExtSkin = keyof typeof EXT_SKINS;

const GRID = 16;
const cellUv = (i: number): [number, number] => [
  ((i % GRID) + 0.5) / GRID,
  (Math.floor(i / GRID) + 0.5) / GRID,
];

/** Index with the extension cells added (unchanged when they are already there). */
export function withExtCells(index: TownKitIndex): TownKitIndex {
  const cells = { ...index.cells };
  EXT_CELLS.forEach(([name, hex], k) => {
    cells[name] ??= { uv: cellUv(EXT_BASE + k), hex };
  });
  // Buildings v2 cells at explicit free atlas slots (bld-v2.ts).
  for (const [name, hex, i] of V2_CELLS) cells[name] ??= { uv: cellUv(i), hex };
  return { ...index, cells };
}

/** Paints the extension cells into a copy of the palette image (8 px cells). */
export function paintExtCells(
  ctx: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>,
  size: number,
): void {
  const px = size / GRID;
  EXT_CELLS.forEach(([, hex], k) => {
    const i = EXT_BASE + k;
    ctx.fillStyle = hex;
    ctx.fillRect((i % GRID) * px, Math.floor(i / GRID) * px, px, px);
  });
  for (const [, hex, i] of V2_CELLS) {
    ctx.fillStyle = hex;
    ctx.fillRect((i % GRID) * px, Math.floor(i / GRID) * px, px, px);
  }
}

/** Copy of `g` with every vertex uv in a `from` cell moved to its `to` cell. */
export function remapCells(
  g: BufferGeometry,
  map: readonly (readonly [[number, number], [number, number]])[],
  cellSize = 1 / GRID,
): BufferGeometry {
  const out = g.clone();
  const uv = out.getAttribute('uv') as BufferAttribute;
  const a = new Float32Array(uv.array);
  for (let i = 0; i < uv.count; i++) {
    const u = a[i * 2]!;
    const v = a[i * 2 + 1]!;
    for (const [from, to] of map) {
      if (Math.abs(u - from[0]) < cellSize / 2 && Math.abs(v - from[1]) < cellSize / 2) {
        a[i * 2] = to[0] + (u - from[0]);
        a[i * 2 + 1] = to[1] + (v - from[1]);
        break;
      }
    }
  }
  out.setAttribute('uv', new BufferAttribute(a, 2));
  return out;
}

/** Modules of a skin family (`S` = skin), derived from the plaster ones. */
export const SKIN_MODULES = [
  'wall-S',
  'window-S',
  'window-S-lit',
  'window-S-broken',
  'doorway-S',
  'stub-S',
];

export function deriveSkins(
  geometries: Map<string, BufferGeometry>,
  uv: (cell: string) => [number, number],
): void {
  const skins: [string, { main: string; dark: string }][] = [
    ...Object.entries(EXT_SKINS),
    ...V2_SKINS.map((s): [string, { main: string; dark: string }] => [
      s,
      { main: `${s}-wall`, dark: `${s}-dark` },
    ]),
  ];
  for (const [skin, c] of skins) {
    const map = [
      [uv('wall-plaster'), uv(c.main)],
      [uv('wall-plaster-dark'), uv(c.dark)],
    ] as const;
    for (const t of SKIN_MODULES) {
      const src = geometries.get(t.replace('S', 'plaster'));
      if (src) geometries.set(t.replace('S', skin), remapCells(src, map));
    }
  }
}
