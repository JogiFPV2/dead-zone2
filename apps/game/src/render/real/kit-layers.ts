import { LAYER, type LayerId } from './layers.js';

/** Marker in the cell → layer table: the cell keeps its flat palette colour (no PBR). */
export const NO_LAYER = 255;

/**
 * Town kit palette cell → `deadzone-pbr` layer (the kit modules keep their palette UVs; the
 * shader projects the layer in world metres and keeps the palette colour as the tint).
 * Order matters: first match wins.
 */
const RULES: readonly (readonly [RegExp, LayerId | null])[] = [
  [/^glass-lit$/, null], // lit windows: emissive, stay flat
  [/glass/, 'szklo'],
  [/brick|chimney/, 'cegla'],
  [/wood|plank|door-panel/, 'drewno'],
  [/^(metal|gutter)$/, 'blacha'],
  [/^roof-/, 'papa'],
  [/^grass/, 'trawa'],
  [/^(asphalt|parking)$/, 'asfalt'],
  [/^sidewalk$/, 'plyty'],
  [/^(curb|concrete|stain)$/, 'beton'],
  [/^dirt$/, 'ziemia'],
  [/wall|stub|doorway|kostka|char/, 'tynk'],
  [/^(blood|carpet|kitchen-tiles)$/, null],
];

export function kitCellLayer(cell: string): number {
  for (const [re, id] of RULES) if (re.test(cell)) return id === null ? NO_LAYER : LAYER[id];
  return LAYER.gladki;
}

/**
 * Lookup texture data: one byte per palette grid cell (row-major, v grows with the row as in the
 * glTF UV convention, `flipY = false`), `NO_LAYER` for unknown cells.
 */
export function buildCellLut(
  cells: Readonly<Record<string, { uv: readonly [number, number] }>>,
  grid = 16,
): Uint8Array {
  const lut = new Uint8Array(grid * grid).fill(NO_LAYER);
  for (const [name, { uv }] of Object.entries(cells)) {
    const col = Math.min(grid - 1, Math.max(0, Math.floor(uv[0] * grid)));
    const row = Math.min(grid - 1, Math.max(0, Math.floor(uv[1] * grid)));
    lut[row * grid + col] = kitCellLayer(name);
  }
  return lut;
}
