import type { Room } from '../../schemas/map/room.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';
import type { MapData } from './map-data.js';

/** `roomId` jest wspólny dla mapy: ten sam pokój w kilku chunkach musi mieć ten sam typ i budynek. */
export function checkMapRooms(map: MapData, sink: ErrorSink): void {
  const first = new Map<string, { room: Room; file: string }>();
  map.chunks.forEach((chunk, ci) => {
    const file = map.chunkFiles[ci]!;
    for (const [roomId, room] of Object.entries(chunk.rooms)) {
      const prev = first.get(roomId);
      if (!prev) {
        first.set(roomId, { room, file });
        continue;
      }
      if (prev.room.roomType !== room.roomType || prev.room.buildingId !== room.buildingId) {
        sink.add({
          code: 'map',
          message: `pokój ${roomId} ma inny roomType/buildingId niż w ${prev.file}`,
          pack: map.pack,
          file,
          path: formatJsonPath(['rooms', roomId]),
        });
      }
    }
  });
}
