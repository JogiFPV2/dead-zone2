import { CHUNK_SIZE, type SimChunk, type SimMap } from '@deadzone/protocol';

/** Resolves world tile coordinates to a chunk and a layer index (floor division for negatives). */
export class TileGrid {
  private lastCx = Number.NaN;
  private lastCy = Number.NaN;
  private lastZ = Number.NaN;
  private lastChunk: SimChunk | undefined;

  constructor(private readonly map: SimMap) {}

  private chunkAt(cx: number, cy: number, z: number): SimChunk | undefined {
    if (cx !== this.lastCx || cy !== this.lastCy || z !== this.lastZ) {
      this.lastCx = cx;
      this.lastCy = cy;
      this.lastZ = z;
      this.lastChunk = this.map.getChunk(cx, cy, z);
    }
    return this.lastChunk;
  }

  private layer(tx: number, ty: number, z: number, name: 'floor' | 'edgeN' | 'edgeW'): number {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    const chunk = this.chunkAt(cx, cy, z);
    if (!chunk) return -1;
    return chunk[name][(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)] ?? -1;
  }

  /** No floor (id 0) or outside the map. */
  isVoid(tx: number, ty: number, z: number): boolean {
    return this.layer(tx, ty, z, 'floor') <= 0;
  }

  /** Wall on the north edge of the tile (segment y = ty, x ∈ [tx, tx+1]). */
  hasWallN(tx: number, ty: number, z: number): boolean {
    return this.layer(tx, ty, z, 'edgeN') > 0;
  }

  /** Wall on the west edge of the tile (segment x = tx, y ∈ [ty, ty+1]). */
  hasWallW(tx: number, ty: number, z: number): boolean {
    return this.layer(tx, ty, z, 'edgeW') > 0;
  }
}
