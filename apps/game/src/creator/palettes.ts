interface PaletteJson {
  id: string;
  colors: { id: string; hex: string }[];
}

/** Base palettes (small JSON; the full pack only loads in the worker / creator). */
const PALETTE_FILES = import.meta.glob<PaletteJson[]>(
  '../../../../packages/content/data/base/palettes/*.json',
  { import: 'default', eager: true },
);
const PALETTES = new Map(
  Object.values(PALETTE_FILES)
    .flat()
    .map((p) => [p.id, new Map(p.colors.map((c) => [c.id, c.hex]))]),
);

/** Hex of a base palette colour (`base:skin` + `olive`), undefined = unknown. */
export function basePaletteHex(palette: string, color: string | undefined): string | undefined {
  return color === undefined ? undefined : PALETTES.get(palette)?.get(color);
}
