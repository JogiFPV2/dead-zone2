import {
  DEFAULT_FOOTPRINT,
  footprintForId,
  occupiedTiles,
  onSurfaceForId,
  surfaceHeightForId,
  type Footprint,
  type FootprintCatalog,
  type TileXY,
} from '@deadzone/content/footprint';

/**
 * Furniture footprint in the renderer (content README „Footprint mebli”). Behind the same flag as
 * the sim, `worldSettings.furniture.footprint` (default off until the maps are rebuilt): off =
 * every object is one tile, drawn exactly as before.
 */
export interface FurnitureFootprints {
  readonly enabled: boolean;
  /** Footprint at `rot = 0` (`w` along the wall = model +x, `h` into the room = model +z). */
  of(contentId: string): Footprint;
  /** Top height (m) of a piece other furniture stands on (`surfaceHeightM`); undefined = none. */
  surfaceOf?(contentId: string): number | undefined;
  /** Whether a piece stands on the furniture below (`placeable.onSurface`: TV, VCR, radio, lamp). */
  onSurface?(contentId: string): boolean;
}

export const FOOTPRINTS_OFF: FurnitureFootprints = Object.freeze({
  enabled: false,
  of: () => DEFAULT_FOOTPRINT,
});

/**
 * Flag from (merged or fragment) world settings: `furniture.footprint` (Symulacja's schema). The
 * top-level `furnitureFootprint` spelling is accepted too; anything but `true` is off.
 */
export function footprintFlag(worldSettings: unknown): boolean {
  const ws = worldSettings as
    { furniture?: { footprint?: unknown }; furnitureFootprint?: unknown } | null | undefined;
  return ws?.furniture?.footprint === true || ws?.furnitureFootprint === true;
}

/** A base pack file (`PackFile`): parsed JSON or raw text. */
type RawFile = { readonly path: string } & ({ readonly json: unknown } | { readonly text: string });

const jsonOf = (f: RawFile): unknown => {
  if ('json' in f) return f.json;
  try {
    return JSON.parse(f.text) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * Footprints from the raw base pack files (`content/base-pack.ts`, not validated here): the flag
 * from `world-settings.json` / `world-settings/*.json`, sizes from `containers/` and `items/`.
 * `force` (dev `?footprint=1`) switches it on regardless of the settings.
 */
export function furnitureFootprintsFromFiles(
  files: readonly RawFile[],
  force = false,
): FurnitureFootprints {
  let enabled = force;
  const catalog: { containers: Record<string, object>; items: Record<string, object> } = {
    containers: {},
    items: {},
  };
  for (const f of files) {
    if (f.path === 'world-settings.json' || f.path.startsWith('world-settings/')) {
      enabled ||= footprintFlag(jsonOf(f));
      continue;
    }
    const into = f.path.startsWith('containers/')
      ? catalog.containers
      : f.path.startsWith('items/')
        ? catalog.items
        : undefined;
    if (!into) continue;
    const json = jsonOf(f);
    for (const def of Array.isArray(json) ? json : [json]) {
      const id = (def as { id?: unknown } | null)?.id;
      if (typeof id === 'string') into[id] = def as object;
    }
  }
  const surfaces = surfacesOf(catalog);
  return enabled ? { ...footprintsOn(catalog), ...surfaces } : { ...FOOTPRINTS_OFF, ...surfaces };
}

/** Surface lookups (`surfaceHeightM`, `onSurface`) from a content catalog, both flags. */
export function surfacesOf(
  catalog: FootprintCatalog,
): Pick<FurnitureFootprints, 'surfaceOf' | 'onSurface'> {
  return {
    surfaceOf: (id) => surfaceHeightForId(catalog, id),
    onSurface: (id) => onSurfaceForId(catalog, id),
  };
}

/**
 * How high a map object stands above its floor: a piece with `onSurface` (VCR, radio, desk lamp)
 * on a tile covered by other furniture sits on that piece's top, `surfaceHeightM` from content,
 * else `fallbackTop` (the lower model's fitted bounding-box top). Anything else stands on the
 * floor (0), as does an `onSurface` piece with nothing underneath.
 */
export function surfaceLift<
  T extends { contentId: string; tx: number; ty: number; z: number; rot?: number | undefined },
>(
  objects: readonly T[],
  fps: FurnitureFootprints,
  o: T,
  fallbackTop: (below: T) => number | undefined,
): number {
  if (!fps.onSurface?.(o.contentId)) return 0;
  const below = surfaceBelow(objects, fps, o);
  if (!below) return 0;
  return fps.surfaceOf?.(below.contentId) ?? fallbackTop(below) ?? 0;
}

/** Wall / ceiling fittings sharing a tile with furniture (#254): never a worktop. */
const NOT_A_SURFACE: ReadonlySet<string> = new Set(['base:light-switch', 'base:ceiling-lamp']);

/**
 * The furniture an `onSurface` piece stands on: one with `surfaceHeightM` on its tile first,
 * else any other floor piece there (wall switches and ceiling lamps never count).
 */
function surfaceBelow<
  T extends { contentId: string; tx: number; ty: number; z: number; rot?: number | undefined },
>(objects: readonly T[], fps: FurnitureFootprints, o: T): T | undefined {
  const others = objects.filter(
    (b) => b !== o && !fps.onSurface?.(b.contentId) && !NOT_A_SURFACE.has(b.contentId),
  );
  const tops = others.filter((b) => fps.surfaceOf?.(b.contentId) !== undefined);
  return objectAtTile(tops, fps, o.tx, o.ty, o.z) ?? objectAtTile(others, fps, o.tx, o.ty, o.z);
}

/** Spacing (m = tiles) between `onSurface` pieces sharing one worktop tile (`surfaceSpread`). */
export const SURFACE_SPREAD_M = 0.45;

/**
 * Sideways offset (m, along the piece's wall, model +x) of an `onSurface` piece that shares its
 * tile with other `onSurface` pieces on furniture (#282 puts the VCR and the TV, or a radio, on
 * the TV stand's anchor tile): spread evenly about the tile centre in map order, so none stands
 * inside another. 0 for a piece alone, on the floor or not `onSurface`. Deterministic.
 */
export function surfaceSpread<
  T extends { contentId: string; tx: number; ty: number; z: number; rot?: number | undefined },
>(objects: readonly T[], fps: FurnitureFootprints, o: T): number {
  if (!fps.onSurface?.(o.contentId)) return 0;
  const group = objects.filter(
    (b) => b.tx === o.tx && b.ty === o.ty && b.z === o.z && fps.onSurface?.(b.contentId),
  );
  if (group.length < 2) return 0;
  if (!surfaceBelow(objects, fps, o)) return 0;
  const step = Math.min(SURFACE_SPREAD_M, 1 / group.length);
  return (group.indexOf(o) - (group.length - 1) / 2) * step;
}

/** Footprints on, sizes from a content catalog (unknown ids = 1×1). */
export function footprintsOn(catalog: FootprintCatalog): FurnitureFootprints {
  const cache = new Map<string, Footprint>();
  return {
    enabled: true,
    of: (id) => {
      let fp = cache.get(id);
      if (!fp) cache.set(id, (fp = footprintForId(catalog, id)));
      return fp;
    },
  };
}

/** Tiles of a map object: all occupied tiles with footprints on, else just its own tile. */
export function objectTiles(
  fps: FurnitureFootprints,
  o: { contentId: string; tx: number; ty: number; rot?: number | undefined },
): TileXY[] {
  if (!fps.enabled) return [{ x: o.tx, y: o.ty }];
  return occupiedTiles(o.tx, o.ty, o.rot ?? 0, fps.of(o.contentId));
}

/**
 * The map object covering world tile (tx, ty) on level z (hover highlight / RMB picking): with
 * footprints on any occupied tile of a sofa or bed finds it, off only its anchor tile does.
 */
export function objectAtTile<
  T extends { contentId: string; tx: number; ty: number; z: number; rot?: number | undefined },
>(
  objects: readonly T[],
  fps: FurnitureFootprints,
  tx: number,
  ty: number,
  z: number,
): T | undefined {
  for (const o of objects) {
    if (o.z !== z) continue;
    if (o.tx === tx && o.ty === ty) return o;
    if (!fps.enabled || o.tx > tx || o.ty > ty) continue;
    if (objectTiles(fps, o).some((t) => t.x === tx && t.y === ty)) return o;
  }
  return undefined;
}

/**
 * Designer's models built 1:1 in metres (1 tile = 1 m; sources in `assets-src/furniture/`). Their
 * origin is the footprint centre with the back-to-wall offset baked in: loaded without `fitted`
 * (no height scale, no re-centring). With footprints on they keep their size at
 * `footprintCenter` and only shrink when larger than the footprint; every other (legacy) model
 * keeps today's one-tile fit stretched over w×h. With footprints off (today's maps) they are
 * squeezed into one tile per axis about that origin (`fitTileRealScale`), so a 2 m sofa stays
 * a sofa (full depth, narrower) and never pokes through the walls.
 * `note`: Designer's placement notes for later (not applied yet: no per-type height table).
 */
export const REAL_SCALE_FURNITURE: ReadonlyMap<string, { readonly note?: string }> = new Map([
  ['base:oven', { note: 'top 0.92 m' }],
  ['base:gas-stove', { note: 'top 0.90 m' }],
  ['base:range', {}],
  ['base:fridge-freezer', {}],
  ['base:desk', {}],
  ['base:tv-stand', { note: 'no built-in VCR any more (base:vcr is its own model)' }],
  ['base:bathroom-cabinet', { note: 'hangs on the wall at 1.15–1.85 m, no floor fit' }],
  ['base:shop-counter', {}],
  ['base:kitchen-sink', {}],
  ['base:bathroom-sink', {}],
  ['base:bathtub', {}],
  ['base:shower', {}],
  ['base:vcr', { note: 'on a tv-stand at +0.55 m or a shelf at +0.32 m' }],
  ['base:radio-set', { note: 'on a desk at +0.75 m' }],
  ['base:double-bed', {}],
  ['base:bed', {}],
  ['base:sofa', {}],
  ['base:metal-shelf', {}],
  ['base:chair', { note: 'seat 0.45 m, free-standing (tile centre)' }],
  ['base:armchair', { note: 'seat 0.45 m, back to the wall' }],
  ['base:light-switch', { note: 'wall plate 8×8 cm at 1.10 m, flush at z = −0.495, no footprint' }],
  ['base:table', { note: 'dining table 160×80×75, free-standing (footprint centre)' }],
  ['base:floor-lamp', { note: 'h 1.58 m, shade = light colour #f4e7c6 (future glow)' }],
  [
    'base:desk-lamp',
    { note: 'h 0.36 m, on a desk/table at +0.75 m (no stacking yet: renders on the floor)' },
  ],
  [
    'base:toilet',
    { note: 'Kenney Furniture Kit toilet (CC0) scaled to 40×70×80, back to the wall' },
  ],
]);

export const isRealScale = (contentId: string): boolean => REAL_SCALE_FURNITURE.has(contentId);
