import type { Polygon, Polyline } from '@deadzone/ui';
import {
  CHUNK_SIZE,
  NO_BUILDING,
  tileIndex,
  type BuildingId,
  type ChunkRange,
  type ChunkSource,
} from './../world/chunk.js';

export interface MinimapGeometry {
  /** Horizontal runs of road tiles as 1 m wide lines (draw with `roadWidth: 1`). */
  roads: Polyline[];
  /** One bounding rectangle per building (world metres, 1 tile = 1 m). */
  buildings: Polygon[];
}

/** Floor content ids drawn as roads on the minimap. */
export const isRoadTile = (id: string | null | undefined): boolean =>
  !!id && /asphalt|road/.test(id);

/**
 * Static minimap layers from the map (level `range.z`): road tiles merged into row runs, and
 * building bounding boxes from the room layer. Built once per map.
 */
export function minimapGeometry(source: ChunkSource, range: ChunkRange): MinimapGeometry {
  const x0 = range.cx0 * CHUNK_SIZE;
  const x1 = (range.cx1 + 1) * CHUNK_SIZE;
  const roads: Polyline[] = [];
  const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  // Per chunk row: the chunks once, palette ids → road flag once (no per-tile lookups).
  const roadId = new Map<number, boolean>();
  const isRoadId = (id: number): boolean => {
    let r = roadId.get(id);
    if (r === undefined) roadId.set(id, (r = isRoadTile(source.tilePalette[id])));
    return r;
  };
  for (let cy = range.cy0; cy <= range.cy1; cy++) {
    const row = [];
    for (let cx = range.cx0; cx <= range.cx1; cx++) {
      const c = source.getChunk(cx, cy, range.z);
      const owner = new Map<number, BuildingId>();
      row.push({ c, owner });
    }
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const y = cy * CHUNK_SIZE + ly;
      let runStart: number | undefined;
      for (let x = x0; x <= x1; x++) {
        let road = false;
        let b: BuildingId = NO_BUILDING;
        if (x < x1) {
          const e = row[Math.floor((x - x0) / CHUNK_SIZE)]!;
          const c = e.c;
          if (c) {
            const i = tileIndex(x - c.coord.cx * CHUNK_SIZE, ly);
            road = isRoadId(c.floor[i] ?? 0);
            const roomId = c.room?.[i] ?? 0;
            if (roomId !== 0 && c.rooms) {
              let o = e.owner.get(roomId);
              if (o === undefined)
                e.owner.set(roomId, (o = c.rooms.get(roomId)?.buildingId ?? NO_BUILDING));
              b = o;
            }
          }
        }
        if (road && runStart === undefined) runStart = x;
        if (!road && runStart !== undefined) {
          roads.push([
            { x: runStart, z: y + 0.5 },
            { x, z: y + 0.5 },
          ]);
          runStart = undefined;
        }
        if (b !== NO_BUILDING) {
          const box = boxes.get(b);
          if (!box) boxes.set(b, { x0: x, y0: y, x1: x + 1, y1: y + 1 });
          else {
            box.x0 = Math.min(box.x0, x);
            box.y0 = Math.min(box.y0, y);
            box.x1 = Math.max(box.x1, x + 1);
            box.y1 = Math.max(box.y1, y + 1);
          }
        }
      }
    }
  }
  const buildings = [...boxes.values()].map((b) => [
    { x: b.x0, z: b.y0 },
    { x: b.x1, z: b.y0 },
    { x: b.x1, z: b.y1 },
    { x: b.x0, z: b.y1 },
  ]);
  return { roads, buildings };
}
