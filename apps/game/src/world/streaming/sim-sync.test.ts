import { describe, expect, it } from 'vitest';
import type { SimEvent } from '@deadzone/protocol';
import { STREAM_PRESETS } from './rings.js';
import { fitSmallWorld } from './setup.js';
import { SimStreamSync, interestFor, type Interest } from './sim-sync.js';

describe('interestFor', () => {
  it('near ring of the view-distance preset around the camera target chunk', () => {
    expect(interestFor({ x: 70, y: -5 }, STREAM_PRESETS.medium)).toEqual({
      cx: 2,
      cy: -1,
      radiusChunks: STREAM_PRESETS.medium.radii[0],
    });
    expect(interestFor({ x: 0, y: 0 }, STREAM_PRESETS.low).radiusChunks).toBe(
      STREAM_PRESETS.low.radii[0],
    );
  });

  it('clamps to 0..16 (small maps fit whole, 0 clears)', () => {
    const big = fitSmallWorld(STREAM_PRESETS.low, { cx0: 0, cy0: 0, cx1: 39, cy1: 0 });
    expect(interestFor({ x: 0, y: 0 }, big).radiusChunks).toBeLessThanOrEqual(16);
    const off = { ...STREAM_PRESETS.low, radii: [0, 3, 5] as const };
    expect(interestFor({ x: 0, y: 0 }, off).radiusChunks).toBe(0);
  });
});

describe('SimStreamSync', () => {
  it('sends setInterest only on chunk / radius changes', () => {
    const sent: Interest[] = [];
    const s = new SimStreamSync(
      (i) => sent.push(i),
      () => {},
    );
    const cfg = STREAM_PRESETS.medium;
    s.update({ x: 1, y: 1 }, cfg);
    s.update({ x: 20, y: 31 }, cfg);
    s.update({ x: 33, y: 1 }, cfg);
    s.update({ x: 33, y: 1 }, STREAM_PRESETS.high);
    expect(sent.map((i) => [i.cx, i.cy, i.radiusChunks])).toEqual([
      [0, 0, cfg.radii[0]],
      [1, 0, cfg.radii[0]],
      [1, 0, Math.min(16, STREAM_PRESETS.high.radii[0])],
    ]);
    const off = { ...cfg, radii: [0, 3, 5] as const };
    s.update({ x: 33, y: 1 }, off);
    s.update({ x: 99, y: 99 }, off);
    expect(sent.length).toBe(4);
    expect(sent[3]!.radiusChunks).toBe(0);
  });

  it('chunkChanged → one invalidate per chunk per frame', () => {
    const inv: string[] = [];
    const s = new SimStreamSync(
      () => {},
      (cx, cy) => inv.push(`${cx},${cy}`),
    );
    const ev = (cx: number, z: number, reason: 'opening' | 'object'): SimEvent => ({
      type: 'chunkChanged',
      tick: 1,
      cx,
      cy: 2,
      z,
      reason,
    });
    s.onEvents([ev(1, 0, 'opening'), ev(1, 1, 'object'), ev(3, 0, 'object')]);
    expect(inv).toEqual([]);
    s.update({ x: 0, y: 0 }, STREAM_PRESETS.medium);
    expect(inv).toEqual(['1,2', '3,2']);
    s.flush();
    expect(inv.length).toBe(2);
  });
});
