import type { SimChunk, WorldSource } from '@deadzone/protocol';
import {
  EDGE_PALETTE,
  TILE_PALETTE,
  type GenColumn,
  type OsmTiles,
  type PlanChunkGenerator,
} from '@deadzone/map/world-source';
import { levelToSimChunk } from './convert.js';

/**
 * The sim's `WorldSource` over a plan chunk generator (docs/sim-architecture.md 9.24): chunks
 * are generated on demand (one column = all storeys, kept in a small LRU; the sim caches
 * `SimChunk`s itself), zone kinds come from the plan's chunk-resolution raster (cheap: the sim
 * asks for every chunk of the world when populating its LOD).
 * Cover zones and pylon blockers ride on each chunk (`SimChunk.zones` / `blockers`, #256).
 */
export function generatorWorldSource(
  gen: PlanChunkGenerator,
  columnCache = 48,
  /** Lazily loaded OSM tiles: a chunk whose data is not in yet is not cached (asked again). */
  tiles?: OsmTiles,
): WorldSource {
  const water = TILE_PALETTE.indexOf('base:water');
  const cols = new Map<number, GenColumn | null>();
  const { cx0, cy0, cx1, cy1 } = gen.bounds;
  const w = cx1 - cx0 + 1;
  const column = (cx: number, cy: number): GenColumn | null => {
    const k = (cy - cy0) * w + (cx - cx0);
    let c = cols.get(k);
    if (c !== undefined) {
      cols.delete(k);
      cols.set(k, c);
      return c;
    }
    if (tiles && !tiles.ready(cx, cy)) {
      void tiles.ensure(cx, cy);
      return null;
    }
    c = gen.column(cx, cy) ?? null;
    cols.set(k, c);
    if (cols.size > columnCache) cols.delete(cols.keys().next().value!);
    return c;
  };
  return {
    seed: gen.seed,
    generatorVersion: gen.generatorVersion,
    bounds: { cx0, cy0, cx1, cy1, z0: 0, z1: gen.maxLevel },
    getChunk(cx, cy, z): SimChunk | undefined {
      if (cx < cx0 || cy < cy0 || cx > cx1 || cy > cy1) return undefined;
      const l = column(cx, cy)?.levels.find((v) => v.z === z);
      return l ? levelToSimChunk(l, water) : undefined;
    },
    chunkKind: (cx, cy) => gen.chunkKind(cx, cy),
    edgeKinds: EDGE_PALETTE.map((e) => (e ? e.kind : null)),
    floorTiles: TILE_PALETTE.map((t) => t),
  };
}
