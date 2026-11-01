import { afterEach, describe, expect, it } from 'vitest';
import { buildingDecals, detailWindowCell, initBldDetail, setBldDetail } from './bld-decals.js';
import { CARD_GRID, DETAIL_CARD } from './window-card.js';

afterEach(() => setBldDetail(false));

const b = (o: object) => ({ id: 7, x0: 10, y0: 20, x1: 30, y1: 30, floors: 3, rect: true, ...o });

describe('bld detail', () => {
  it('is off by default, ?bld-detail=1 turns it on', () => {
    expect(initBldDetail('')).toBe(false);
    expect(initBldDetail('?bld-detail=1')).toBe(true);
  });
  it('detail cells fit the card atlas after the interior cards', () => {
    for (const c of Object.values(DETAIL_CARD)) {
      expect(c).toBeGreaterThanOrEqual(16);
      expect(c).toBeLessThan(CARD_GRID * CARD_GRID);
    }
  });
  it('windows of ok buildings and with the flag off keep their card', () => {
    expect(detailWindowCell('ruin', 1, 2)).toBeUndefined();
    setBldDetail(true);
    expect(detailWindowCell('ok', 1, 2)).toBeUndefined();
    const cells = new Set<number | undefined>();
    for (let s = 0; s < 200; s++) cells.add(detailWindowCell('abandoned', 1, s));
    expect(cells.has(DETAIL_CARD.broken)).toBe(true);
    expect(cells.has(DETAIL_CARD.boarded)).toBe(true);
    expect(cells.has(undefined)).toBe(true);
  });
  it('special types get signs, abandoned flat roofs get holes', () => {
    const cells = (o: object) => buildingDecals(b(o)).map((d) => d.cell);
    expect(cells({ look: 'school' })).toContain(DETAIL_CARD.signSchool);
    expect(cells({ look: 'school' })).toContain(DETAIL_CARD.bandSchool);
    expect(cells({ look: 'police' })).toContain(DETAIL_CARD.stripePolice);
    expect(cells({ look: 'hospital' })).toContain(DETAIL_CARD.cross);
    const ruin = buildingDecals(b({ condition: 'ruin', roofShape: 'flat' }));
    expect(ruin.filter((d) => d.flat)).toHaveLength(4);
    expect(ruin.every((d) => !d.flat || (d.y > 8 && d.x > 10 && d.x < 30))).toBe(true);
    expect(cells({ look: 'house' })).toEqual([]);
    expect(buildingDecals(b({ look: 'school', rect: false }))).toEqual([]);
  });
});

it('decals sit on the outer edge of the inclusive tile bbox', () => {
  const ds = buildingDecals(b({ look: 'school' }));
  // Main facade S (w ≥ d): the wall is on the far edge of tile row y1 = 30.
  expect(ds.some((d) => Math.abs(d.z - 31.16) < 1e-6)).toBe(true);
  expect(ds.every((d) => d.z < 31.2 && d.z > 19.8)).toBe(true);
});
