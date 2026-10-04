import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../settings/schema.js';
import {
  NOISE_ENTER_MS,
  NOISE_LOOK,
  NoiseRingModel,
  noiseFadeMs,
  noiseHoldMs,
  noiseTier,
  showsNoise,
  type NoiseEventIn,
} from './noise-model.js';

const ev = (kind: NoiseEventIn['kind'], radius: number, loudness: number, x = 0): NoiseEventIn => ({
  x,
  y: 0,
  z: 0,
  radius,
  loudness,
  kind,
});

describe('noise circle model', () => {
  it('setting: Wył. / Tylko głośne (≥ 10 m, default) / Zawsze', () => {
    expect(DEFAULT_SETTINGS.interface.noiseDisplay).toBe('loud');
    expect(sanitizeSettings({ interface: { noiseDisplay: 'bogus' } }).interface.noiseDisplay).toBe(
      'loud',
    );
    expect(sanitizeSettings({ interface: { noiseDisplay: 'off' } }).interface.noiseDisplay).toBe(
      'off',
    );
    expect(showsNoise('off', 90)).toBe(false);
    expect(showsNoise('loud', 9.9)).toBe(false);
    expect(showsNoise('loud', 10)).toBe(true);
    expect(showsNoise('always', 1.5)).toBe(true);
    expect(showsNoise('always', 0)).toBe(false);
  });

  it('tiers and the barely visible look', () => {
    expect([noiseTier(0.1), noiseTier(0.5), noiseTier(0.79), noiseTier(0.8)]).toEqual([
      'quiet',
      'mid',
      'mid',
      'loud',
    ]);
    expect([NOISE_LOOK.quiet.fill, NOISE_LOOK.mid.fill, NOISE_LOOK.loud.fill]).toEqual([
      0.03, 0.04, 0.05,
    ]);
    expect([NOISE_LOOK.quiet.stroke, NOISE_LOOK.mid.stroke, NOISE_LOOK.loud.stroke]).toEqual([
      0.14, 0.18, 0.22,
    ]);
    expect([NOISE_LOOK.mid.widthPx, NOISE_LOOK.loud.widthPx]).toEqual([1.5, 2]);
  });

  it('enter 0.85r → r, hold, ease-in fade, then gone', () => {
    const m = new NoiseRingModel();
    m.push(ev('window', 20, 1), 0, 'loud');
    expect(m.sample(0)!.radiusM).toBeCloseTo(17);
    expect(m.sample(0)!.alpha).toBe(0);
    const held = m.sample(NOISE_ENTER_MS + 10)!;
    expect(held.radiusM).toBe(20);
    expect(held.alpha).toBe(1);
    expect(held.tier).toBe('loud');
    const fadeStart = NOISE_ENTER_MS + noiseHoldMs('loud');
    expect(m.sample(fadeStart + noiseFadeMs('loud') / 2)!.alpha).toBeCloseTo(0.75);
    expect(m.sample(fadeStart + noiseFadeMs('loud') + 1)).toBeUndefined();
    expect(m.ring).toBeUndefined();
  });

  it('Tylko głośne ignores walking; Zawsze shows it', () => {
    const m = new NoiseRingModel();
    m.push(ev('step', 5, 0.25), 0, 'loud');
    expect(m.sample(100)).toBeUndefined();
    m.push(ev('step', 5, 0.25), 0, 'always');
    expect(m.sample(300)!.tier).toBe('quiet');
  });

  it('steps refresh the same ring (no new entry), walk → run tweens the radius', () => {
    const m = new NoiseRingModel();
    m.push(ev('step', 5, 0.25), 0, 'always');
    const born = m.ring!.bornMs;
    for (let t = 500; t <= 3000; t += 500) m.push(ev('step', 5, 0.25, t / 1000), t, 'always');
    expect(m.ring!.bornMs).toBe(born);
    expect(m.sample(3100)!.alpha).toBe(1); // never fades while walking
    m.push(ev('run', 12, 0.5), 3500, 'always');
    expect(m.ring!.bornMs).toBe(born);
    const mid = m.sample(3500 + 90)!.radiusM;
    expect(mid).toBeGreaterThan(5);
    expect(mid).toBeLessThan(12);
    expect(m.sample(3500 + 200)!.radiusM).toBe(12);
    expect(m.sample(3700)!.tier).toBe('mid');
  });

  it('footstep rings follow the player; others stay where the noise was', () => {
    const m = new NoiseRingModel();
    m.push(ev('run', 12, 0.5), 0, 'loud');
    expect(m.sample(200, false, { x: 3, y: 4, z: 0 })).toMatchObject({ x: 3, y: 4 });
    m.push(ev('shot', 45, 1, 7), 300, 'loud');
    expect(m.sample(400, false, { x: 3, y: 4, z: 0 })).toMatchObject({ x: 7, y: 0 });
  });

  it('a louder ring in its hold ignores a quieter one; after the hold it is replaced', () => {
    const m = new NoiseRingModel();
    m.push(ev('shot', 45, 1), 0, 'loud');
    m.push(ev('run', 12, 0.5), 500, 'loud');
    expect(m.ring!.kind).toBe('shot');
    m.push(ev('run', 12, 0.5), NOISE_ENTER_MS + noiseHoldMs('loud') + 10, 'loud');
    expect(m.ring!.kind).toBe('run');
    // A louder newcomer always replaces.
    m.push(ev('kick', 16, 0.8), 2000, 'loud');
    expect(m.ring!.kind).toBe('kick');
  });

  it('reduced motion: no entry scale or radius tween, linear fade', () => {
    const m = new NoiseRingModel();
    m.push(ev('step', 5, 0.25), 0, 'always');
    expect(m.sample(0, true)).toMatchObject({ radiusM: 5, alpha: 1 });
    m.push(ev('run', 12, 0.5), 400, 'always');
    expect(m.sample(410, true)!.radiusM).toBe(12);
    const fadeStart = 400 + noiseHoldMs('mid');
    expect(m.sample(fadeStart + noiseFadeMs('mid') / 2, true)!.alpha).toBeCloseTo(0.5);
  });

  it('switching the setting drops a ring it would not show', () => {
    const m = new NoiseRingModel();
    m.push(ev('step', 5, 0.25), 0, 'always');
    m.setDisplay('loud');
    expect(m.ring).toBeUndefined();
    m.push(ev('shot', 45, 1), 0, 'always');
    m.setDisplay('off');
    expect(m.sample(100)).toBeUndefined();
  });
});
