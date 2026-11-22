import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, type ChunkData } from '../chunk.js';
import { buildFarVectorGeometry, buildMidGeometry, clipToChunk, hasVector } from './lod-meshes.js';
import type { WorldChunk } from './source.js';

const N = CHUNK_SIZE * CHUNK_SIZE;
const chunk: WorldChunk = {
  cx: 1,
  cy: 0,
  levels: new Map([[0, { floor: new Uint16Array(N).fill(1) } as unknown as ChunkData]]),
  areas: [{ surface: 'base:parking', order: 20, rings: [[2, 2, 20, 5, 18, 14, 3, 12]] }],
  roads: [{ surface: 'base:asphalt', r: 3, rs: 0, bridge: false, pts: [-5, 25, 40, 20], d0: 0 }],
  // A 5° building partly over the chunk edge (outline in world metres).
  buildings: [
    {
      id: 7,
      x0: 50,
      y0: 18,
      x1: 70,
      y1: 30,
      floors: 2,
      outline: [50, 18, 70, 19.7, 69, 31, 49, 29.3],
    },
  ],
};

describe('vector LOD (generated maps)', () => {
  it('draws smooth areas, roads and outlined buildings, clipped to the chunk', () => {
    expect(hasVector(chunk)).toBe(true);
    for (const g of [buildFarVectorGeometry(chunk), buildMidGeometry(chunk, undefined)]) {
      const pos = g!.geometry.getAttribute('position');
      let area = 0;
      let roof = 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        expect(x).toBeGreaterThanOrEqual(-3.01);
        expect(x).toBeLessThanOrEqual(CHUNK_SIZE + 3.01);
        expect(z).toBeGreaterThanOrEqual(-3.01);
        expect(z).toBeLessThanOrEqual(CHUNK_SIZE + 3.01);
        const y = pos.getY(i);
        if (Math.abs(y - (0.02 + 20 * 0.004)) < 1e-6) area++;
        if (y > 4) roof++;
      }
      expect(area).toBeGreaterThan(0);
      expect(roof).toBeGreaterThan(0);
    }
  });

  it('clipToChunk keeps the part of a polygon inside the chunk square', () => {
    const p = clipToChunk([
      [-10, 5],
      [10, 5],
      [10, 40],
    ]);
    for (const [x, z] of p) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(CHUNK_SIZE);
    }
    expect(p.length).toBeGreaterThanOrEqual(3);
  });
});
