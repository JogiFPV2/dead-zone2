import type { Polygon, Polyline } from '@deadzone/ui';
import {
  CHUNK_SIZE,
  NO_BUILDING,
  tileIndex,
  type ChunkRange,
  type ChunkSource,
} from './../world/chunk.js';
import { BuildingLookup } from '../world/building-lookup.js';

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
  const y0 = range.cy0 * CHUNK_SIZE;
  const y1 = (range.cy1 + 1) * CHUNK_SIZE;
  const lookup = new BuildingLookup(source);
  const roads: Polyline[] = [];
  const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  const floorAt = (x: number, y: number): string | null | undefined => {
    const c = source.getChunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), range.z);
    if (!c) return undefined;
    const lx = x - c.coord.cx * CHUNK_SIZE;
    const ly = y - c.coord.cy * CHUNK_SIZE;
    return source.tilePalette[c.floor[tileIndex(lx, ly)] ?? 0];
  };
  for (let y = y0; y < y1; y++) {
    let runStart: number | undefined;
    for (let x = x0; x <= x1; x++) {
      const road = x < x1 && isRoadTile(floorAt(x, y));
      if (road && runStart === undefined) runStart = x;
      if (!road && runStart !== undefined) {
        roads.push([
          { x: runStart, z: y + 0.5 },
          { x, z: y + 0.5 },
        ]);
        runStart = undefined;
      }
      if (x < x1) {
        const b = lookup.at(x, y, range.z);
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
