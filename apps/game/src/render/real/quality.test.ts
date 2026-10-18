import { describe, expect, it } from 'vitest';
import { REAL_QUALITY, checkDrawBudget, withOverrides } from './quality.js';

describe('REAL_QUALITY (STYLE.md §5)', () => {
  it('low: 512 textures, 1024 shadows, no SSAO, 250 draw calls', () => {
    const q = REAL_QUALITY.low;
    expect(q.textureSize).toBe(512);
    expect(q.shadow.mapSize).toBe(1024);
    expect(q.ssao.mode).toBe('off');
    expect(q.envIntensity).toBe(0);
    expect(q.normalScale).toBe(0.8);
    expect(q.maxDrawCalls).toBe(250);
    expect(q.targetFps).toBe(60);
  });

  it('medium: 1024 textures, 2048 shadows, half-res GTAO 8 samples', () => {
    const q = REAL_QUALITY.medium;
    expect([q.textureSize, q.anisotropy, q.shadow.mapSize]).toEqual([1024, 4, 2048]);
    expect(q.ssao).toEqual({ mode: 'gtao', resolutionScale: 0.5, samples: 8 });
  });

  it('high: 4096 shadows, full GTAO 16 samples, RoomEnvironment 0.12', () => {
    const q = REAL_QUALITY.high;
    expect([q.textureSize, q.anisotropy, q.shadow.mapSize]).toEqual([1024, 8, 4096]);
    expect(q.ssao).toEqual({ mode: 'gtao', resolutionScale: 1, samples: 16 });
    expect(q.envIntensity).toBe(0.12);
  });

  it('all presets: PCF normalBias 0.09, bias -0.0005', () => {
    for (const q of Object.values(REAL_QUALITY)) {
      expect(q.shadow.normalBias).toBe(0.09);
      expect(q.shadow.bias).toBe(-0.0005);
    }
  });
});

describe('withOverrides', () => {
  it('drops in new values, ignores bad ones', () => {
    const q = withOverrides({
      low: { shadow: { mapSize: 512 }, textureSize: 'big', ssao: { mode: 'gtao', samples: 4 } },
      high: { ssao: { mode: 'off' } },
    });
    expect(q.low.shadow).toEqual({ ...REAL_QUALITY.low.shadow, mapSize: 512 });
    expect(q.low.textureSize).toBe(512);
    expect(q.low.ssao).toEqual({ mode: 'gtao', resolutionScale: 1, samples: 4 });
    expect(q.high.ssao).toEqual({ mode: 'off' });
    expect(q.medium).toEqual(REAL_QUALITY.medium);
    expect(withOverrides(null)).toEqual(REAL_QUALITY);
  });
});

describe('checkDrawBudget', () => {
  it('low must stay under 250 draw calls', () => {
    expect(checkDrawBudget(180, REAL_QUALITY.low)).toEqual({ calls: 180, max: 250, ok: true });
    expect(checkDrawBudget(250, REAL_QUALITY.low).ok).toBe(false);
  });
});
