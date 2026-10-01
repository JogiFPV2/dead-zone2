import {
  CHUNK_SIZE,
  CHUNK_TILES,
  simMapFromData,
  type SimMap,
  type SimMapChunkData,
  type SimStairs,
} from '@deadzone/protocol';
import type { Sim } from '../sim.js';

/** One level of a test map: floor / walls as functions of world tiles. */
export interface LevelSpec {
  z: number;
  floor?: (x: number, y: number) => boolean;
  wallN?: (x: number, y: number) => boolean;
  wallW?: (x: number, y: number) => boolean;
}

/** A flight in world tiles (converted to chunk-local `SimChunk.stairs`). */
export interface StairSpec extends Omit<SimStairs, 'tx' | 'ty'> {
  x: number;
  y: number;
  z: number;
}

/** Multi-level test map [0, size)² per level (size a multiple of 32). */
export function buildLevels(
  levels: readonly LevelSpec[],
  stairs: readonly StairSpec[] = [],
  size = 64,
): SimMap {
  const chunks: SimMapChunkData[] = [];
  for (const lv of levels) {
    for (let cy = 0; cy < size / CHUNK_SIZE; cy++) {
      for (let cx = 0; cx < size / CHUNK_SIZE; cx++) {
        const floor = new Uint16Array(CHUNK_TILES);
        const edgeN = new Uint16Array(CHUNK_TILES);
        const edgeW = new Uint16Array(CHUNK_TILES);
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const x = cx * CHUNK_SIZE + lx;
            const y = cy * CHUNK_SIZE + ly;
            const i = ly * CHUNK_SIZE + lx;
            floor[i] = (lv.floor?.(x, y) ?? true) ? 1 : 0;
            edgeN[i] = lv.wallN?.(x, y) ? 1 : 0;
            edgeW[i] = lv.wallW?.(x, y) ? 1 : 0;
          }
        }
        const own = stairs
          .filter(
            (s) =>
              s.z === lv.z &&
              Math.floor(s.x / CHUNK_SIZE) === cx &&
              Math.floor(s.y / CHUNK_SIZE) === cy,
          )
          .map((s) => ({
            tx: s.x - cx * CHUNK_SIZE,
            ty: s.y - cy * CHUNK_SIZE,
            dir: s.dir,
            len: s.len,
          }));
        chunks.push({
          cx,
          cy,
          z: lv.z,
          floor,
          edgeN,
          edgeW,
          ...(own.length ? { stairs: own } : {}),
        });
      }
    }
  }
  return simMapFromData({ chunks });
}

/** Per-sim command sequence (the hash covers it, so two runs stay comparable). */
export function commander(sim: Sim) {
  let seq = 0;
  return {
    move(dx: number, dy: number, gait?: 'walk' | 'run' | 'sneak'): void {
      sim.enqueue({
        type: 'move',
        dx,
        dy,
        ...(gait ? { gait } : {}),
        tick: sim.tick,
        playerId: 0,
        seq: seq++,
      });
    },
    aim(x: number, y: number): void {
      sim.enqueue({ type: 'aim', x, y, tick: sim.tick, playerId: 0, seq: seq++ });
    },
    shove(): void {
      sim.enqueue({ type: 'shove', tick: sim.tick, playerId: 0, seq: seq++ });
    },
  };
}
