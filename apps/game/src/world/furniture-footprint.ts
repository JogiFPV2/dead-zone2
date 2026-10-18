import {
  DEFAULT_FOOTPRINT,
  footprintForId,
  occupiedTiles,
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
  return enabled ? footprintsOn(catalog) : FOOTPRINTS_OFF;
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
]);

export const isRealScale = (contentId: string): boolean => REAL_SCALE_FURNITURE.has(contentId);
