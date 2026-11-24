import { CHUNK_SIZE, type ChunkSource } from '../chunk.js';
import { PAINTED_BLD, ROOMS_SIZE, roomKind } from '../../render/painted-buildings.js';

/** Storeys kept in the rooms texture (RGBA = z 0..3). */
const LEVELS = 4;
const CHUNKS = ROOMS_SIZE / CHUNK_SIZE;

/** `kind << 4 | variant` of a room: the variant is a hash of the building and the room. */
export function roomCode(type: string | undefined, building: number, room: number): number {
  let h = Math.imul(building ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(room + 1, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 15;
  return (roomKind(type) << 4) | (h & 15);
}

/**
 * Rooms around the player for the painted buildings (`render/painted-buildings.ts`): a
 * `ROOMS_SIZE`² tile texture, one channel per storey, `roomCode` per tile (0 = outside). Moved in
 * whole chunks with the player; rewritten when the centre chunk or the loaded chunks change.
 */
export class PaintedRooms {
  private cx = NaN;
  private cy = NaN;
  private stamp = -1;
  private readonly data: Uint8Array;

  constructor(private readonly source: ChunkSource & { readonly size?: number }) {
    this.data = PAINTED_BLD.pbRooms.value.image.data as Uint8Array;
  }

  /** Player at world tile (x, y); `loadedStamp` changes whenever chunks load or unload. */
  update(x: number, y: number, loadedStamp: number): void {
    const cx = Math.floor(x / CHUNK_SIZE) - CHUNKS / 2 + 1;
    const cy = Math.floor(y / CHUNK_SIZE) - CHUNKS / 2 + 1;
    if (cx === this.cx && cy === this.cy && loadedStamp === this.stamp) return;
    this.cx = cx;
    this.cy = cy;
    this.stamp = loadedStamp;
    this.data.fill(0);
    for (let j = 0; j < CHUNKS; j++)
      for (let i = 0; i < CHUNKS; i++)
        for (let z = 0; z < LEVELS; z++) {
          const c = this.source.getChunk(cx + i, cy + j, z);
          if (!c?.room || !c.rooms) continue;
          const codes = new Map<number, number>();
          for (let k = 0; k < CHUNK_SIZE * CHUNK_SIZE; k++) {
            const r = c.room[k] ?? 0;
            if (r === 0) continue;
            let code = codes.get(r);
            if (code === undefined) {
              const info = c.rooms.get(r);
              code = roomCode(info?.type, info?.buildingId ?? 0, r);
              codes.set(r, code);
            }
            const tx = i * CHUNK_SIZE + (k % CHUNK_SIZE);
            const ty = j * CHUNK_SIZE + Math.floor(k / CHUNK_SIZE);
            this.data[(ty * ROOMS_SIZE + tx) * 4 + z] = code;
          }
        }
    PAINTED_BLD.pbRoomsAt.value.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE);
    PAINTED_BLD.pbRooms.value.needsUpdate = true;
  }
}
