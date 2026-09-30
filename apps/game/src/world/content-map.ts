import type { MapData, MapZone } from '@deadzone/content';
import {
  CHUNK_TILES,
  tileIndex,
  type ChunkData,
  type ChunkRange,
  type ChunkSource,
  type ContentId,
  type EdgeDef,
  type RoomInfo,
} from './chunk.js';

export interface LoadedMap {
  source: ChunkSource;
  range: ChunkRange;
  /** Named zones from the manifest (global tiles); empty for maps without zones. */
  zones: MapZone[];
}

/** Appends-on-miss lookup into a 1-based palette whose index 0 stays empty. */
function interner<T>(palette: (T | null)[], key: (v: T) => string) {
  const index = new Map<string, number>();
  return (v: T): number => {
    const k = key(v);
    let i = index.get(k);
    if (i === undefined) index.set(k, (i = palette.push(v) - 1));
    return i;
  };
}

/**
 * Content map (validated by @deadzone/content) -> renderer ChunkSource. Chunk palettes are local
 * and 1-based (v -> palette[v - 1], 0 = empty); they are remapped to one map-wide tilePalette.
 * Sparse edges become edgeN/edgeW layers with a map-wide edgePalette keyed by (type, contentId).
 * Room and building ids are already map-global. Only level z = 0 of the bounding range is served.
 */
export function mapDataToChunkSource(map: MapData): LoadedMap {
  const tilePalette: (ContentId | null)[] = [null];
  const edgePalette: (EdgeDef | null)[] = [null];
  const tileId = interner<ContentId>(tilePalette, (v) => v);
  const edgeId = interner<EdgeDef>(edgePalette, (d) => `${d.kind}|${d.id}`);
  const chunks = new Map<string, ChunkData>();

  for (const c of map.chunks) {
    const { cx, cy, z } = c.address;
    const remap = c.palette.map((id) => tileId(id as ContentId));
    const layer = (src: Uint16Array | undefined) =>
      src && Uint16Array.from(src, (v) => (v === 0 ? 0 : (remap[v - 1] ?? 0)));
    const edgeN = new Uint16Array(CHUNK_TILES);
    const edgeW = new Uint16Array(CHUNK_TILES);
    for (const e of c.edges) {
      const id = edgeId({ id: e.contentId as ContentId, kind: e.type });
      (e.side === 'n' ? edgeN : edgeW)[tileIndex(e.x, e.y)] = id;
    }
    const rooms = new Map<number, RoomInfo>(
      Object.entries(c.rooms).map(([k, r]) => [
        Number(k),
        { type: r.roomType as ContentId, buildingId: r.buildingId },
      ]),
    );
    const roof = layer(c.layers.roof);
    const room = c.layers.room;
    const objects = c.objects.map((o) => ({
      contentId: o.contentId as ContentId,
      x: o.x,
      y: o.y,
      rot: o.rot,
    }));
    chunks.set(`${cx},${cy},${z}`, {
      coord: { cx, cy, z },
      floor: layer(c.layers.floor) ?? new Uint16Array(CHUNK_TILES),
      edgeN,
      edgeW,
      rooms,
      ...(roof ? { roof } : {}),
      ...(room ? { room } : {}),
      ...(objects.length > 0 ? { objects } : {}),
    });
  }

  const ground = map.manifest.chunks.filter((a) => a.z === 0);
  const range: ChunkRange = {
    cx0: Math.min(...ground.map((a) => a.cx)),
    cy0: Math.min(...ground.map((a) => a.cy)),
    cx1: Math.max(...ground.map((a) => a.cx)),
    cy1: Math.max(...ground.map((a) => a.cy)),
    z: 0,
  };
  const zones = (map.manifest.zones ?? []).map((z) => ({
    ...z,
    rects: z.rects.map((r) => ({ ...r })),
  }));
  return {
    range,
    zones,
    source: { tilePalette, edgePalette, getChunk: (cx, cy, z) => chunks.get(`${cx},${cy},${z}`) },
  };
}
