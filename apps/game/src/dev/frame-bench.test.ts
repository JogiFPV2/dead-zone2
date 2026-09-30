import { expect, it } from 'vitest';
import { FrameBench, formatBench } from './frame-bench.js';

it('averages over a rolling window and tracks the worst frame', () => {
  const b = new FrameBench(2);
  expect(b.report()).toEqual({ frames: 0, updateMs: 0, renderMs: 0, totalMs: 0, maxMs: 0 });
  b.record({ updateMs: 10, renderMs: 10 });
  b.record({ updateMs: 1, renderMs: 2 });
  b.record({ updateMs: 3, renderMs: 4 });
  expect(b.frames).toBe(3);
  expect(b.report()).toEqual({ frames: 2, updateMs: 2, renderMs: 3, totalMs: 5, maxMs: 7 });
  expect(formatBench(200, b.report())).toBe(
    '200 entities · cpu 5.00 ms/frame (update 2.00 + render 3.00, max 7.00)',
  );
});
