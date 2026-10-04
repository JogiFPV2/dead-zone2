import type { TileCategory } from '../../schemas/tile.js';
import type { MapChunk } from '../../schemas/map/chunk.js';
import type { ContentIndex } from '../content-index.js';
import type { ContentErrorCode, ErrorSink } from '../errors.js';
import { formatJsonPath, type PathSegment } from '../json-path.js';
import { indoorProblem } from './check-map-indoor.js';
import type { MapData } from './map-data.js';

/**
 * Referencje mapy na końcowym zbiorze contentu:
 * - paleta → `tiles/` (użyte w `floor` muszą mieć category `floor`, w `roof` — `roof`),
 * - krawędź → `tiles/` z category równym `type`,
 * - obiekt → typ schowka albo przedmiot `placeable`,
 * - `roomType` → co najmniej jedna loot table ma go w `rooms`,
 * - meble tylko w środku (`indoorProblem`).
 */
export function checkMapRefs(map: MapData, index: ContentIndex, sink: ErrorSink): void {
  const roomTypes = new Set<string>();
  for (const t of index.map('lootTable').values()) t.data.rooms.forEach((r) => roomTypes.add(r));

  map.chunks.forEach((chunk, ci) => {
    const add = (code: ContentErrorCode, message: string, ...path: PathSegment[]) =>
      sink.add({
        code,
        message,
        pack: map.pack,
        file: map.chunkFiles[ci]!,
        path: formatJsonPath(path),
      });
    const tile = (id: string, want: TileCategory, ...path: PathSegment[]) => {
      const def = index.get('tile', id);
      if (!def)
        add('missing_ref', `mapa „${map.id}” wskazuje na nieistniejące tile „${id}”`, ...path);
      else if (def.data.category !== want) {
        add('wrong_kind', `„${id}” musi mieć category ${want}, ma ${def.data.category}`, ...path);
      }
    };

    const used = usedValues(chunk);
    chunk.palette.forEach((id, i) => {
      const inFloor = used.floor.has(i + 1);
      const inRoof = used.roof.has(i + 1);
      if (inFloor) tile(id, 'floor', 'palette', i);
      if (inRoof) tile(id, 'roof', 'palette', i);
      if (!inFloor && !inRoof && !index.has('tile', id)) {
        add('missing_ref', `mapa „${map.id}” wskazuje na nieistniejące tile „${id}”`, 'palette', i);
      }
    });
    chunk.edges.forEach((e, i) => tile(e.contentId, e.type, 'edges', i, 'contentId'));
    chunk.objects.forEach((o, i) => {
      const container = index.get('containerType', o.contentId);
      const item = container ? undefined : index.get('item', o.contentId);
      if (container || item?.data.kind === 'placeable') {
        const problem = indoorProblem(chunk, o, container?.data.tags ?? item?.data.tags, index);
        if (problem) add('map', problem, 'objects', i);
      }
      if (container) return;
      if (!item) {
        add(
          'missing_ref',
          `obiekt „${o.contentId}” nie jest typem schowka ani przedmiotem`,
          'objects',
          i,
          'contentId',
        );
      } else if (item.data.kind !== 'placeable') {
        add(
          'wrong_kind',
          `obiekt „${o.contentId}” musi być przedmiotem placeable, jest ${item.data.kind}`,
          'objects',
          i,
          'contentId',
        );
      }
    });
    for (const [roomId, room] of Object.entries(chunk.rooms)) {
      if (!roomTypes.has(room.roomType)) {
        add(
          'missing_ref',
          `żadna loot table nie ma typu pomieszczenia „${room.roomType}” w rooms`,
          'rooms',
          roomId,
          'roomType',
        );
      }
    }
  });
}

function usedValues(chunk: MapChunk): { floor: Set<number>; roof: Set<number> } {
  return { floor: new Set(chunk.layers.floor), roof: new Set(chunk.layers.roof ?? []) };
}
