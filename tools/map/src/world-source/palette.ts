/**
 * Fixed, world-wide palettes of the lazy world generator (docs/streaming.md: palettes are global
 * and constant for a source's lifetime; new content = new generator version). Index 0 = empty.
 */

/** Floor tiles (base pack `tiles/floors.json` + water) then roofs (`tiles/roofs.json`). */
export const TILE_PALETTE: readonly (string | null)[] = [
  null,
  'base:grass',
  'base:concrete',
  'base:kitchen-tiles',
  'base:asphalt',
  'base:sidewalk',
  'base:dirt',
  'base:parking',
  'base:rail',
  'base:water',
  'base:roof-shingles',
  'base:roof-flat',
  'base:roof-gable',
  'base:roof-tile',
  'base:roof-felt',
  'base:roof-corrugated',
];

export type EdgeKind = 'wall' | 'window' | 'door' | 'fence' | 'gate';

/** Edge content (`tiles/edges.json`) with its kind (the content `category`). */
export const EDGE_PALETTE: readonly ({ id: string; kind: EdgeKind } | null)[] = [
  null,
  { id: 'base:brick-wall', kind: 'wall' },
  { id: 'base:wooden-window', kind: 'window' },
  { id: 'base:wooden-door', kind: 'door' },
  { id: 'base:wall-plain', kind: 'wall' },
  { id: 'base:window-plain', kind: 'window' },
  { id: 'base:door-plain', kind: 'door' },
  { id: 'base:wooden-fence', kind: 'fence' },
  { id: 'base:metal-gate', kind: 'gate' },
  { id: 'base:railing', kind: 'fence' },
  { id: 'base:siding-green', kind: 'wall' },
  { id: 'base:siding-beige', kind: 'wall' },
  { id: 'base:siding-blue', kind: 'wall' },
  { id: 'base:plaster-wall', kind: 'wall' },
  { id: 'base:wall-hospital', kind: 'wall' },
  { id: 'base:wall-police', kind: 'wall' },
  { id: 'base:wall-school', kind: 'wall' },
  { id: 'base:wall-shop', kind: 'wall' },
  { id: 'base:wall-kostka', kind: 'wall' },
  { id: 'base:wall-plank', kind: 'wall' },
  { id: 'base:wall-gas', kind: 'wall' },
  { id: 'base:wall-pharmacy', kind: 'wall' },
  { id: 'base:wall-burnt', kind: 'wall' },
  { id: 'base:window-shop', kind: 'window' },
  { id: 'base:door-glass', kind: 'door' },
];

const tileIds = new Map(TILE_PALETTE.map((t, i) => [t, i] as const));
const edgeIds = new Map(EDGE_PALETTE.map((e, i) => [e?.id ?? null, i] as const));

/** Palette id of a floor / roof tile; throws on content the palette does not know. */
export function tileId(id: string): number {
  const i = tileIds.get(id);
  if (i === undefined || i === 0) throw new Error(`world-source: kafel ${id} spoza palety`);
  return i;
}

/** Palette id of an edge content id. */
export function edgeId(id: string): number {
  const i = edgeIds.get(id);
  if (i === undefined || i === 0) throw new Error(`world-source: krawędź ${id} spoza palety`);
  return i;
}

/** Outdoor floors (content tag `base:outdoor`): no furniture there (#131). */
export const OUTDOOR_FLOORS: ReadonlySet<string> = new Set([
  'base:grass',
  'base:asphalt',
  'base:sidewalk',
  'base:dirt',
  'base:parking',
  'base:rail',
  'base:water',
]);
/** Outdoor floors where props (bins, benches, firewood) may stand: not the road or parking. */
export const PROP_FLOORS: ReadonlySet<string> = new Set([
  'base:grass',
  'base:sidewalk',
  'base:dirt',
]);

/** Ground classes of the raster (index into GROUND_TILES). */
export const G_GRASS = 0;
export const G_DIRT = 1;
export const G_CONCRETE = 2;
export const G_SIDEWALK = 3;
export const G_PARKING = 4;
export const G_ASPHALT = 5;
export const G_RAIL = 6;
export const G_WATER = 7;
export const GROUND_TILES = [
  'base:grass',
  'base:dirt',
  'base:concrete',
  'base:sidewalk',
  'base:parking',
  'base:asphalt',
  'base:rail',
  'base:water',
] as const;
export const GROUND_TILE_IDS: readonly number[] = GROUND_TILES.map(tileId);
