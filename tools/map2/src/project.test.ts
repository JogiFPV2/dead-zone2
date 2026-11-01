import { describe, expect, it } from 'vitest';
import { projection, tmForward } from './project.js';

describe('projection', () => {
  it('origin is (0, 0)', () => {
    expect(projection().toLocal(22.0535, 50.5825)).toEqual([0, 0]);
  });
  it('matches PROJ tmerc (k=1, WGS84) to 1 cm', () => {
    // pyproj: +proj=tmerc +lat_0=50.5825 +lon_0=22.0535 +k=1 +ellps=WGS84 → (6134.534, -6948.905)
    const [x, y] = projection().toLocal(22.14, 50.52);
    expect(x).toBeCloseTo(6134.53, 1);
    expect(y).toBeCloseTo(6948.91, 1);
  });
  it('matches UTM 34N (k0 0.9996) like the old extract', () => {
    // pyproj EPSG:32634 for (22.05, 50.58): E 574 340.45, N 5 603 647.24 (offset 500 km easting).
    const [e, n] = tmForward(22.05, 50.58, 21, 0.9996);
    expect(e + 500000).toBeCloseTo(574340.45, 0);
    expect(n).toBeCloseTo(5603647.24, 0);
  });
});
