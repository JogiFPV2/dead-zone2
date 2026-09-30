import type { LampDef } from '../lighting/street-lamps.js';
import { CHUNK_SIZE, type ChunkRange } from './chunk.js';
import { TEST_MAP_RANGE } from './test-map.js';

/**
 * TEMPORARY placeholder lamp list for the test map (the map format has no objects layer yet).
 * Roads run along x, z = 32k … 32k+4; each crossing gets four lamps on the verges with the arm
 * over the road. Roughly one in three is broken (spec: "4 of 6 work"), deterministically.
 */
export function createTestLamps(range: ChunkRange = TEST_MAP_RANGE): LampDef[] {
  const lamps: LampDef[] = [];
  for (let cy = range.cy0; cy <= range.cy1; cy++) {
    for (let cx = range.cx0; cx <= range.cx1; cx++) {
      const ox = cx * CHUNK_SIZE;
      const oz = cy * CHUNK_SIZE;
      const corners: Omit<LampDef, 'working'>[] = [
        { x: ox - 0.6, z: oz + 8, armX: 1, armZ: 0 },
        { x: ox + 4.6, z: oz + 20, armX: -1, armZ: 0 },
        { x: ox + 9, z: oz - 0.6, armX: 0, armZ: 1 },
        { x: ox + 22, z: oz + 4.6, armX: 0, armZ: -1 },
      ];
      corners.forEach((c, k) => {
        lamps.push({ ...c, working: (cx * 7 + cy * 13 + k * 5 + 40) % 3 !== 0 });
      });
    }
  }
  // Yard lamp by the test building's front door (building x 11–20, y 11–18, door at x 13).
  lamps.push({ x: 9.4, z: 20.4, armX: 1, armZ: 0, working: true });
  return lamps;
}
