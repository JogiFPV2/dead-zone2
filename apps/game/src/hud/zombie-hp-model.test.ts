import { describe, expect, it } from 'vitest';
import { hpBand, hpSegments, hpView, pickNearest } from './zombie-hp-model.js';

describe('zombie hp model', () => {
  it('bands: green > 60 %, yellow 30–60 %, red < 30 %', () => {
    expect(hpBand(1)).toBe('ok');
    expect(hpBand(0.61)).toBe('ok');
    expect(hpBand(0.6)).toBe('warn');
    expect(hpBand(0.3)).toBe('warn');
    expect(hpBand(0.29)).toBe('low');
  });

  it('segments: 6, at least one while alive', () => {
    expect(hpSegments(1)).toBe(6);
    expect(hpSegments(0.24)).toBe(2);
    expect(hpSegments(0.5)).toBe(3);
    expect(hpSegments(0.01)).toBe(1);
  });

  it('healthy zombies show nothing; target bubble; wounded bar only with the setting', () => {
    const off = { showWounded: false, targeting: true };
    const on = { showWounded: true, targeting: true };
    expect(hpView(1, false, false, on)).toBe('none');
    expect(hpView(0.5, false, false, off)).toBe('none');
    expect(hpView(0.5, false, false, on)).toBe('bar');
    expect(hpView(1, false, true, off)).toBe('target');
    expect(hpView(0.5, false, true, { showWounded: true, targeting: false })).toBe('bar');
    expect(hpView(0.5, true, true, on)).toBe('none');
  });

  it('picks the nearest sample within the radius', () => {
    const s = [0, 0, 0, 0, 2, 0, 0, 0, 2.5, 0.2, 0, 0];
    expect(pickNearest(s, 3, 4, 2.4, 0, 1)).toBe(2);
    expect(pickNearest(s, 3, 4, 9, 9, 1)).toBe(-1);
    expect(pickNearest(s, 3, 4, 2.4, 0, 1, (i) => i === 2)).toBe(1);
  });
});
