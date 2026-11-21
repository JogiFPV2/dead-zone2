import { describe, expect, it } from 'vitest';
import {
  moonIllumination,
  spellKind,
  WEATHER_KINDS,
  weatherAt,
  winterness,
  type WeatherKind,
} from './weather.js';

describe('weather and moon (protocol 50)', () => {
  it('3 July 1993 (game day 1) is a full moon; two weeks later a new moon', () => {
    expect(moonIllumination(22 * 60)).toBeGreaterThan(0.97);
    expect(moonIllumination(15 * 1440 + 22 * 60)).toBeLessThan(0.05);
  });

  it('winterness: 0 in July, 1 in January', () => {
    expect(winterness(196)).toBeLessThan(0.01);
    expect(winterness(15)).toBe(1);
  });

  it('deterministic by seed and minute; spells last spellMinutes; seasons shape the mix', () => {
    expect(weatherAt(7, 1234)).toEqual(weatherAt(7, 1234));
    const count = (doy: number) => {
      const c = Object.fromEntries(WEATHER_KINDS.map((k) => [k, 0])) as Record<WeatherKind, number>;
      for (let n = 0; n < 4000; n++) c[spellKind(99, n, doy)]++;
      return c;
    };
    const summer = count(196);
    const winter = count(15);
    expect(summer.snow).toBe(0);
    expect(winter.storm).toBe(0);
    expect(winter.snow).toBeGreaterThan(400);
    for (const k of ['clear', 'overcast', 'rain', 'storm', 'fog'] as const)
      expect(summer[k]).toBeGreaterThan(100);
    // Inside a spell (after the fade) the kind and the effects stay the same.
    const a = weatherAt(5, 360 * 10 + 100);
    const b = weatherAt(5, 360 * 10 + 300);
    expect(b.kind).toBe(a.kind);
    expect(b.cloud).toBe(a.cloud);
    expect(b.blend).toBe(1);
  });

  it('transition: the first fadeMinutes blend from the previous kind', () => {
    // Find a spell boundary where the kind changes.
    let n = 1;
    while (spellKind(3, n, 184) === spellKind(3, n - 1, 184)) n++;
    const start = weatherAt(3, n * 360);
    expect(start.from).not.toBe(start.kind);
    expect(start.blend).toBe(0);
    const mid = weatherAt(3, n * 360 + 20);
    expect(mid.blend).toBe(0.5);
    expect(weatherAt(3, n * 360 + 40).blend).toBe(1);
  });

  it('forced kind: always that kind with its full effects', () => {
    const fog = weatherAt(1, 5000, undefined, 'fog');
    expect(fog).toMatchObject({ kind: 'fog', from: 'fog', blend: 1, sightMul: 0.45 });
  });
});
