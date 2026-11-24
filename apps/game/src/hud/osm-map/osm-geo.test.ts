import { describe, expect, it } from 'vitest';
import {
  STW2_ORIGIN,
  fromLocal,
  lonLatToTile,
  metresPerPx,
  stw2WorldToLonLat,
  toLocal,
} from './osm-geo.js';

describe('osm-geo', () => {
  it('the stw2 world shift lands on the map2 origin', () => {
    const p = stw2WorldToLonLat(17000, 19000);
    expect(p.lon).toBeCloseTo(STW2_ORIGIN.lon, 9);
    expect(p.lat).toBeCloseTo(STW2_ORIGIN.lat, 9);
  });

  it('fromLocal inverts toLocal across the whole 30 km map', () => {
    for (const [x, y] of [
      [0, 0],
      [12000, -15000],
      [-16000, 13000],
      [15500, 15500],
    ] as const) {
      const [bx, by] = toLocal(fromLocal(x, y));
      expect(bx).toBeCloseTo(x, 2);
      expect(by).toBeCloseTo(y, 2);
    }
  });

  it('east is +x and south is +y (1 km ≈ 0,009° lat)', () => {
    const p = fromLocal(1000, 1000);
    expect(p.lon).toBeGreaterThan(STW2_ORIGIN.lon);
    expect(p.lat).toBeLessThan(STW2_ORIGIN.lat);
    expect(STW2_ORIGIN.lat - p.lat).toBeCloseTo(0.009, 3);
  });

  it('slippy tile of Stalowa Wola at zoom 16', () => {
    const t = lonLatToTile(STW2_ORIGIN, 16);
    // https://tile.openstreetmap.org/16/36782/22060.png covers KEN × Okulickiego.
    expect(Math.floor(t.x)).toBe(36782);
    expect(Math.floor(t.y)).toBe(22060);
    expect(metresPerPx(STW2_ORIGIN.lat, 16)).toBeCloseTo(1.517, 2);
  });
});
