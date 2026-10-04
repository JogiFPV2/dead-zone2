import { CHUNK_SIZE, type ChunkData, type ChunkSource } from '../world/chunk.js';

/** Content id of the fuel pump map object (`worldSettings.vehicles.fuel.pumpItem`). */
export const FUEL_PUMP = 'base:fuel-pump' as const;

/**
 * Dev `?pump=x,y`: the map source with `base:fuel-pump` objects added on floor 0 (no map has a
 * pump yet). The sim gets them through `chunkSourceToSimMap`, the renderer as map objects.
 */
export function withPumps(
  source: ChunkSource,
  pumps: readonly { x: number; y: number }[],
  id: `${string}:${string}` = FUEL_PUMP,
): ChunkSource {
  const cache = new Map<string, ChunkData | undefined>();
  const getChunk = (cx: number, cy: number, z: number): ChunkData | undefined => {
    const key = `${cx},${cy},${z}`;
    if (cache.has(key)) return cache.get(key);
    const data = source.getChunk(cx, cy, z);
    const add =
      z === 0
        ? pumps.filter(
            (p) => Math.floor(p.x / CHUNK_SIZE) === cx && Math.floor(p.y / CHUNK_SIZE) === cy,
          )
        : [];
    const out =
      data && add.length
        ? {
            ...data,
            objects: [
              ...(data.objects ?? []),
              ...add.map((p) => ({
                contentId: id,
                x: p.x - cx * CHUNK_SIZE,
                y: p.y - cy * CHUNK_SIZE,
                rot: 0,
              })),
            ],
          }
        : data;
    cache.set(key, out);
    return out;
  };
  return {
    tilePalette: source.tilePalette,
    ...(source.edgePalette ? { edgePalette: source.edgePalette } : {}),
    getChunk,
  };
}
