import { expect, it } from 'vitest';
import { formatStats } from './format.js';

it('formats fps, draw calls and triangles', () => {
  expect(formatStats({ fps: 59.6, calls: 12, triangles: 123456 })).toBe(
    '60 fps · 12 draw calls · 123,456 tris',
  );
});
