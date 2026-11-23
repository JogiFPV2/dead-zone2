import { describe, expect, it } from 'vitest';
import { GROAN_GAP_SEC, Thunder, ZombieVoices, ambienceLoop, isNight } from './ambient-sfx.js';
import { GROANS, RAIN, THUNDER } from './world-sfx.js';
import {
  SYNTH_SOUNDS,
  gunshotSamples,
  groanSamples,
  rainSamples,
  thunderSamples,
} from './synth.js';

describe('ambient sfx', () => {
  it('groans only with zombies near, never two within the gap', () => {
    const v = new ZombieVoices();
    expect(v.update(1, [], 0, 0, () => 0)).toBeUndefined();
    const z = [{ x: 3, z: 0 }];
    const first = v.update(1, z, 0, 0, () => 0);
    expect(first && GROANS.includes(first.id as (typeof GROANS)[number])).toBe(true);
    expect(first!.volume).toBeGreaterThan(0);
    expect(v.update(GROAN_GAP_SEC / 2, z, 0, 0, () => 0)).toBeUndefined();
    expect(v.update(GROAN_GAP_SEC, z, 0, 0, () => 0)).toBeDefined();
    // Unlucky roll: silence.
    expect(new ZombieVoices().update(0.016, z, 0, 0, () => 0.99)).toBeUndefined();
  });

  it('picks rain over crickets, crickets only at night, nothing on a quiet day', () => {
    expect(ambienceLoop(0.6, false, 0)?.id).toBe(RAIN);
    expect(ambienceLoop(1, true, 0)?.volume).toBe(1);
    expect(ambienceLoop(0, true, 0)?.id).toBe('amb-crickets');
    expect(ambienceLoop(0, true, 1)).toBeUndefined();
    expect(ambienceLoop(0, false, 0)).toBeUndefined();
    expect(isNight(0)).toBe(true);
    expect(isNight(1)).toBe(false);
  });

  it('rolls thunder once after each lightning flash, delayed', () => {
    const t = new Thunder();
    expect(t.update(0.1, 1, () => 0)).toBeUndefined();
    expect(t.update(0.1, 1, () => 0)).toBeUndefined();
    let got = 0;
    for (let i = 0; i < 40; i++) if (t.update(0.1, 0, () => 0)?.id === THUNDER) got++;
    expect(got).toBe(1);
  });
});

describe('procedural sounds', () => {
  const rate = 22050;
  it('every generator gives a finite, normalised, non-silent buffer', () => {
    for (const [id, gen] of Object.entries(SYNTH_SOUNDS)) {
      const s = gen(rate);
      expect(s.length, id).toBeGreaterThan(rate * 0.04);
      let peak = 0;
      for (const v of s) {
        expect(Number.isFinite(v), id).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak, id).toBeGreaterThan(0.3);
      expect(peak, id).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic and the variants differ', () => {
    expect(gunshotSamples(rate, 'rifle')).toEqual(gunshotSamples(rate, 'rifle'));
    expect(gunshotSamples(rate, 'shotgun').length).toBeGreaterThan(gunshotSamples(rate).length);
    expect(groanSamples(rate, 0)).not.toEqual(groanSamples(rate, 1));
    expect(thunderSamples(rate).length).toBe(Math.round(rate * 4.5));
  });

  it('rain loops without a click at the seam', () => {
    const r = rainSamples(rate);
    // The jump from the last sample back to the first is no bigger than any step inside.
    let maxStep = 0;
    for (let i = 1; i < r.length; i++) maxStep = Math.max(maxStep, Math.abs(r[i]! - r[i - 1]!));
    expect(Math.abs(r[0]! - r[r.length - 1]!)).toBeLessThanOrEqual(maxStep);
  });
});
