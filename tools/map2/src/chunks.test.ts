import { expect, it } from 'vitest';
import { chunkIndex } from './chunks.js';
import type { Edge } from './graph.js';
import { roadProfile } from './profile.js';

it('indexes an edge in every 32 m chunk it touches (with its width)', () => {
  const e: Edge = {
    id: 7,
    way: 1,
    a: 1,
    b: 2,
    pts: [
      [10, 16],
      [100, 16],
    ],
    p: roadProfile({ highway: 'residential' })!,
  };
  const idx = chunkIndex([e]);
  expect([...idx.keys()].sort()).toEqual(['0,0', '1,0', '2,0', '3,0']);
  const edge: Edge = {
    ...e,
    pts: [
      [10, 30],
      [100, 30],
    ],
  };
  expect(chunkIndex([edge]).has('0,1')).toBe(true);
});
