import { describe, expect, it } from 'vitest';
import {
  LOD_FAR,
  LOD_MID,
  LOD_NEAR,
  STREAM_PRESETS,
  chunkDistance,
  planChunks,
  ringLod,
  type StreamConfig,
} from './rings.js';

const cfg: StreamConfig = {
  ...STREAM_PRESETS.medium,
  radii: [1, 2, 3],
  maxChunks: [100, 100, 100],
};
const bounds = { cx0: -100, cy0: -100, cx1: 100, cy1: 100 };

describe('rings', () => {
  it('measures Chebyshev distance to the nearest centre', () => {
    expect(chunkDistance(3, -1, [{ cx: 0, cy: 0 }])).toBe(3);
    expect(
      chunkDistance(3, -1, [
        { cx: 0, cy: 0 },
        { cx: 3, cy: 0 },
      ]),
    ).toBe(1);
  });

  it('upgrades at the radius and downgrades one hysteresis step later', () => {
    expect(ringLod(1, undefined, cfg)).toBe(LOD_NEAR);
    expect(ringLod(2, undefined, cfg)).toBe(LOD_MID);
    expect(ringLod(4, undefined, cfg)).toBeUndefined();
    // Loaded near at distance 2 stays near (1 + hysteresis 1), at 3 drops to mid.
    expect(ringLod(2, LOD_NEAR, cfg)).toBe(LOD_NEAR);
    expect(ringLod(3, LOD_NEAR, cfg)).toBe(LOD_MID);
    // Loaded far stays loaded at 4, unloads at 5.
    expect(ringLod(4, LOD_FAR, cfg)).toBe(LOD_FAR);
    expect(ringLod(5, LOD_FAR, cfg)).toBeUndefined();
    // A mid chunk that comes back into the near ring upgrades straight away.
    expect(ringLod(1, LOD_MID, cfg)).toBe(LOD_NEAR);
  });

  it('plans the square rings sorted by distance and LOD', () => {
    const plan = planChunks([{ cx: 0, cy: 0 }], () => undefined, [], cfg, bounds);
    expect(plan).toHaveLength(49);
    expect(plan.filter((p) => p.lod === LOD_NEAR)).toHaveLength(9);
    expect(plan.filter((p) => p.lod === LOD_MID)).toHaveLength(16);
    expect(plan.filter((p) => p.lod === LOD_FAR)).toHaveLength(24);
    expect(plan[0]).toMatchObject({ cx: 0, cy: 0, dist: 0 });
    for (let i = 1; i < plan.length; i++)
      expect(plan[i]!.dist).toBeGreaterThanOrEqual(plan[i - 1]!.dist);
  });

  it('clips at the world bounds', () => {
    const plan = planChunks([{ cx: 0, cy: 0 }], () => undefined, [], cfg, {
      cx0: 0,
      cy0: 0,
      cx1: 10,
      cy1: 10,
    });
    expect(plan).toHaveLength(16);
  });

  it('keeps loaded chunks within hysteresis outside the square', () => {
    const plan = planChunks(
      [{ cx: 0, cy: 0 }],
      (k) => (k === '4,0' ? LOD_FAR : undefined),
      [{ cx: 4, cy: 0 }],
      cfg,
      bounds,
    );
    expect(plan.find((p) => p.key === '4,0')?.lod).toBe(LOD_FAR);
  });

  it('demotes overflow past the ring caps to coarser rings', () => {
    const capped = { ...cfg, maxChunks: [4, 100, 10] as const };
    const plan = planChunks([{ cx: 0, cy: 0 }], () => undefined, [], capped, bounds);
    expect(plan.filter((p) => p.lod === LOD_NEAR)).toHaveLength(4);
    expect(plan.filter((p) => p.lod === LOD_FAR)).toHaveLength(10);
    expect(plan.find((p) => p.cx === 0 && p.cy === 0)?.lod).toBe(LOD_NEAR);
  });

  it('presets grow with the view distance and fit their caps', () => {
    for (const p of Object.values(STREAM_PRESETS)) {
      const [n, m, f] = p.radii;
      expect(n).toBeLessThanOrEqual(m);
      expect(m).toBeLessThanOrEqual(f);
      expect((2 * n + 1) ** 2).toBeLessThanOrEqual(p.maxChunks[0]);
      expect((2 * m + 1) ** 2 - (2 * n + 1) ** 2).toBeLessThanOrEqual(p.maxChunks[1]);
      expect((2 * f + 1) ** 2 - (2 * m + 1) ** 2).toBeLessThanOrEqual(p.maxChunks[2]);
    }
  });
});

describe('fitSmallWorld', () => {
  it('keeps small authored maps fully in the near ring, leaves big worlds alone', async () => {
    const { fitSmallWorld } = await import('./setup.js');
    const m = STREAM_PRESETS.medium;
    expect(fitSmallWorld(m, { cx0: -2, cy0: -2, cx1: 1, cy1: 1 }).radii[0]).toBe(4);
    expect(fitSmallWorld(m, { cx0: 0, cy0: 0, cx1: 249, cy1: 249 })).toBe(m);
  });
});
