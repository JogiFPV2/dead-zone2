import { describe, expect, it } from 'vitest';
import { dayOfYearForGameDay, GAME_START_DAY_OF_YEAR, sunAt } from './index.js';

const deg = (r: number) => (r * 180) / Math.PI;
const SUMMER = 172; // 21 June
const WINTER = 355; // 21 December

describe('sunAt (Stalowa Wola, 50.58° N)', () => {
  it('summer noon: ~62° high, due south', () => {
    const s = sunAt(12, SUMMER);
    expect(deg(s.elevation)).toBeGreaterThan(61);
    expect(deg(s.elevation)).toBeLessThan(63.5);
    expect(deg(s.azimuth)).toBeCloseTo(180, 3);
    expect(s.direction.z).toBeGreaterThan(0); // south = +Z
    expect(Math.abs(s.direction.x)).toBeLessThan(1e-6);
  });

  it('winter noon: ~16° high', () => {
    const e = deg(sunAt(12, WINTER).elevation);
    expect(e).toBeGreaterThan(15);
    expect(e).toBeLessThan(17);
  });

  it('below the horizon at night, summer and winter', () => {
    for (const day of [SUMMER, WINTER, 80]) {
      for (const t of [0, 1.5, 23]) {
        const s = sunAt(t, day);
        expect(s.elevation).toBeLessThan(0);
        expect(s.aboveHorizon).toBe(false);
        expect(s.direction.y).toBeLessThan(0);
      }
    }
    expect(sunAt(20, WINTER).aboveHorizon).toBe(false);
  });

  it('rises in the east (+X) and sets in the west (−X)', () => {
    for (const day of [SUMMER, 80, WINTER]) {
      const rise = sunAt(day === WINTER ? 8.5 : 6.5, day);
      const set = sunAt(day === WINTER ? 15.5 : 17.5, day);
      expect(rise.direction.x).toBeGreaterThan(0.3);
      expect(set.direction.x).toBeLessThan(-0.3);
      expect(deg(rise.azimuth)).toBeGreaterThan(45);
      expect(deg(rise.azimuth)).toBeLessThan(135);
      expect(deg(set.azimuth)).toBeGreaterThan(225);
      expect(deg(set.azimuth)).toBeLessThan(315);
    }
  });

  it('equinox: rises near 06:00 due east, symmetric around noon', () => {
    const am = sunAt(9, 80);
    const pm = sunAt(15, 80);
    expect(am.elevation).toBeCloseTo(pm.elevation, 9);
    expect(am.direction.x).toBeCloseTo(-pm.direction.x, 9);
    expect(Math.abs(deg(sunAt(6, 80).elevation))).toBeLessThan(2);
  });

  it('summer: up before 05:00 and after 19:30 solar, northern sky at sunrise', () => {
    expect(sunAt(4.5, SUMMER).aboveHorizon).toBe(true);
    expect(sunAt(19.5, SUMMER).aboveHorizon).toBe(true);
    expect(sunAt(4.5, SUMMER).direction.z).toBeLessThan(0); // north-east = −Z
  });

  it('direction is a unit vector and matches azimuth/elevation', () => {
    for (let t = 0; t < 24; t += 0.75) {
      const s = sunAt(t, 200);
      const { x, y, z } = s.direction;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 8);
      expect(y).toBeCloseTo(Math.sin(s.elevation), 8);
      const cosEl = Math.cos(s.elevation);
      expect(x).toBeCloseTo(cosEl * Math.sin(s.azimuth), 8);
      expect(-z).toBeCloseTo(cosEl * Math.cos(s.azimuth), 8);
    }
  });

  it('deterministic and wraps time (24 h = 0 h, −1 h = 23 h)', () => {
    expect(sunAt(13.25, 123)).toEqual(sunAt(13.25, 123));
    expect(sunAt(24, 100)).toEqual(sunAt(0, 100));
    expect(sunAt(-1, 100)).toEqual(sunAt(23, 100));
  });
});

describe('dayOfYearForGameDay', () => {
  it('day 1 = start day, wraps after 365', () => {
    expect(dayOfYearForGameDay(1)).toBe(GAME_START_DAY_OF_YEAR);
    expect(dayOfYearForGameDay(2)).toBe(GAME_START_DAY_OF_YEAR + 1);
    expect(dayOfYearForGameDay(1, 365)).toBe(365);
    expect(dayOfYearForGameDay(2, 365)).toBe(1);
    expect(dayOfYearForGameDay(366, 1)).toBe(1);
  });
});
