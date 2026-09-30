import { CHUNK_SIZE, type SimChunk, type SimEdgeKind, type SimMap } from '@deadzone/protocol';

/** Resolves world tile coordinates to a chunk and a layer index (floor division for negatives). */
export class TileGrid {
  private lastCx = Number.NaN;
  private lastCy = Number.NaN;
  private lastZ = Number.NaN;
  private lastChunk: SimChunk | undefined;
  /** Edge ids that let sight through (windows), from `SimMap.edgeKinds`. */
  private readonly seeThrough: Uint8Array;

  constructor(private readonly map: SimMap) {
    const kinds = map.edgeKinds ?? [];
    this.seeThrough = new Uint8Array(Math.max(1, kinds.length));
    kinds.forEach((k: SimEdgeKind | null, id) => {
      if (k === 'window' || k === 'door') this.seeThrough[id] = 1;
    });
  }

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

  /** Edge id on the north / west side (0 = none, -1 = outside the map). */
  edgeN(tx: number, ty: number, z: number): number {
    return this.layer(tx, ty, z, 'edgeN');
  }

  edgeW(tx: number, ty: number, z: number): number {
    return this.layer(tx, ty, z, 'edgeW');
  }

  /** Edge id blocks sight: any wall; windows (and doors, open for now) let it through. */
  blocksSight(edgeId: number): boolean {
    return edgeId > 0 && this.seeThrough[edgeId] !== 1;
  }
}
