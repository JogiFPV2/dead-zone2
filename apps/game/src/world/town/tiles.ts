import {
  CHUNK_SIZE,
  NO_BUILDING,
  tileIndex,
  type BuildingId,
  type ChunkData,
  type ChunkSource,
  type ContentId,
} from '../chunk.js';

/** Cross-chunk tile lookups on one level (floor content, room type, building), cached. */
export class MapTiles {
  private readonly cache = new Map<string, ChunkData | undefined>();

  constructor(
    readonly source: ChunkSource,
    readonly z: number,
  ) {}

  // Last chunk asked for: tile scans stay in one chunk for long runs (no key / map per tile).
  private lastCx = NaN;
  private lastCy = NaN;
  private lastChunk: ChunkData | undefined;

  private chunkAt(cx: number, cy: number): ChunkData | undefined {
    if (cx === this.lastCx && cy === this.lastCy) return this.lastChunk;
    const key = `${cx},${cy}`;
    if (!this.cache.has(key)) this.cache.set(key, this.source.getChunk(cx, cy, this.z));
    this.lastCx = cx;
    this.lastCy = cy;
    return (this.lastChunk = this.cache.get(key));
  }

  chunk(tx: number, ty: number): { c: ChunkData | undefined; i: number } {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    return { c: this.chunkAt(cx, cy), i: tileIndex(tx - cx * CHUNK_SIZE, ty - cy * CHUNK_SIZE) };
  }

  /** Floor content id, undefined outside the map / empty. */
  floor(tx: number, ty: number): ContentId | undefined {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    const c = this.chunkAt(cx, cy);
    if (!c) return undefined;
    const id = c.floor[tileIndex(tx - cx * CHUNK_SIZE, ty - cy * CHUNK_SIZE)] ?? 0;
    return id === 0 ? undefined : (this.source.tilePalette[id] ?? undefined);
  }

  roomType(tx: number, ty: number): ContentId | undefined {
    const { c, i } = this.chunk(tx, ty);
    const r = c?.room?.[i] ?? 0;
    return r === 0 ? undefined : c?.rooms?.get(r)?.type;
  }

  building(tx: number, ty: number): BuildingId {
    const { c, i } = this.chunk(tx, ty);
    const r = c?.room?.[i] ?? 0;
    return r === 0 ? NO_BUILDING : (c?.rooms?.get(r)?.buildingId ?? NO_BUILDING);
  }

  roof(tx: number, ty: number): ContentId | undefined {
    const { c, i } = this.chunk(tx, ty);
    const id = c?.roof?.[i] ?? 0;
    return id === 0 ? undefined : (this.source.tilePalette[id] ?? undefined);
  }

  /** Edge content + kind on the N (line z = ty) or W (line x = tx) border of a tile. */
  edge(axis: 'N' | 'W', tx: number, ty: number) {
    const { c, i } = this.chunk(tx, ty);
    const id = (axis === 'N' ? c?.edgeN : c?.edgeW)?.[i] ?? 0;
    return id === 0 ? undefined : (this.source.edgePalette?.[id] ?? undefined);
  }
}
