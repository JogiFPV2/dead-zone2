import { describe, expect, it } from 'vitest';
import { DEFAULT_VEHICLE_CONFIG as cfg } from './config.js';
import { engineNoiseRadius } from './system.js';
import type { Vehicle } from './types.js';

const car = (throttle: number, vx: number) => ({ throttle, vx, vy: 0 }) as unknown as Vehicle;

describe('engine noise radius', () => {
  it('idle when stopped, full at full throttle', () => {
    expect(engineNoiseRadius(car(0, 0), cfg)).toBe(cfg.noiseIdleTiles);
    expect(engineNoiseRadius(car(1, 0), cfg)).toBe(cfg.noiseFullTiles);
  });
  it('grows with speed while coasting, capped at full', () => {
    const mid = engineNoiseRadius(car(0, cfg.noiseFullSpeed / 2), cfg);
    expect(mid).toBeCloseTo((cfg.noiseIdleTiles + cfg.noiseFullTiles) / 2);
    expect(engineNoiseRadius(car(0, cfg.noiseFullSpeed * 3), cfg)).toBe(cfg.noiseFullTiles);
  });
  it('reverse throttle is as loud as forward', () => {
    expect(engineNoiseRadius(car(-1, 0), cfg)).toBe(cfg.noiseFullTiles);
  });
});
