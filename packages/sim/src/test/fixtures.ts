import {
  CHUNK_SIZE,
  CHUNK_TILES,
  simMapFromData,
  type SimMap,
  type SimMapChunkData,
} from '@deadzone/protocol';

export interface MapSpec {
  /** Size in tiles, starting at (0, 0). Must be a multiple of CHUNK_SIZE. */
  width?: number;
  height?: number;
  /** Floor id at tile (default 1 = floor everywhere). */
  floor?: (x: number, y: number) => number;
  wallN?: (x: number, y: number) => boolean;
  wallW?: (x: number, y: number) => boolean;
}

/** Builds an in-memory map on level 0 covering [0, width) × [0, height). */
export function buildMap(spec: MapSpec = {}): SimMap {
  const width = spec.width ?? CHUNK_SIZE * 2;
  const height = spec.height ?? CHUNK_SIZE * 2;
  const chunks: SimMapChunkData[] = [];
  for (let cy = 0; cy < height / CHUNK_SIZE; cy++) {
    for (let cx = 0; cx < width / CHUNK_SIZE; cx++) {
      const floor = new Uint16Array(CHUNK_TILES);
      const edgeN = new Uint16Array(CHUNK_TILES);
      const edgeW = new Uint16Array(CHUNK_TILES);
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const x = cx * CHUNK_SIZE + lx;
          const y = cy * CHUNK_SIZE + ly;
          const i = ly * CHUNK_SIZE + lx;
          floor[i] = spec.floor ? spec.floor(x, y) : 1;
          edgeN[i] = spec.wallN?.(x, y) ? 1 : 0;
          edgeW[i] = spec.wallW?.(x, y) ? 1 : 0;
        }
      }
      chunks.push({ cx, cy, z: 0, floor, edgeN, edgeW });
    }
  }
  return simMapFromData({ chunks });
}
