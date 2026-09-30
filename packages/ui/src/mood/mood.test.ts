// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { declsFor, readCss, v } from '../test/css.js';
import { tokens } from '../tokens/tokens.generated.js';
import { createVignette, setHudMood, setHudMotion } from './mood.js';
import {
  applyVignetteAt,
  chipModeAt,
  mixVignette,
  moodAt,
  parseRgba,
  vignetteAt,
} from './vignette.js';

const css = readCss('mood/mood.css');
const hm = (h: number, m = 0) => h * 60 + m;
const alpha = (c: string) => parseRgba(c).a;

describe('mood keyframes (CSS)', () => {
  it('night / dusk / day map to their vignette tokens; the HUD itself is unchanged', () => {
    expect(declsFor(css, "[data-hud-mood='night']")['--hud-vignette']).toBe(
      v('color.overlay.vignette.night'),
    );
    expect(declsFor(css, "[data-hud-mood='dusk']")['--hud-vignette']).toBe(
      v('color.overlay.vignette.dusk'),
    );
    expect(declsFor(css, "[data-hud-mood='day']")['--hud-vignette']).toBe(
      v('color.overlay.vignette.day'),
    );
    expect(declsFor(css, '.dz-vignette').background).toBe(
      'radial-gradient(ellipse at center, transparent 45%, var(--hud-vignette) 100%)',
    );
    const root = document.createElement('div');
    setHudMood(root, 'dusk');
    expect(root.dataset.hudMood).toBe('dusk');
    expect(createVignette(document).className).toBe('dz-vignette');
  });
});

describe('vignette interpolation (Designer, answer 1)', () => {
  const { day, dusk, night } = tokens.color.overlay.vignette;

  it('hits the keyframes exactly', () => {
    expect(alpha(vignetteAt(hm(12)))).toBeCloseTo(alpha(day));
    expect(alpha(vignetteAt(hm(19, 30)))).toBeCloseTo(alpha(dusk));
    expect(alpha(vignetteAt(hm(20, 30)))).toBeCloseTo(alpha(night));
    expect(alpha(vignetteAt(hm(2)))).toBeCloseTo(alpha(night));
    expect(alpha(vignetteAt(hm(5, 45)))).toBeCloseTo(alpha(dusk));
    expect(alpha(vignetteAt(hm(6, 30)))).toBeCloseTo(alpha(day));
  });

  it('blends smoothly between keyframes (no hard switch)', () => {
    const samples = Array.from({ length: 121 }, (_, i) => alpha(vignetteAt(hm(18, 30) + i)));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]! - 1e-9); // monotonic towards night
      expect(Math.abs(samples[i]! - samples[i - 1]!)).toBeLessThan(0.01); // no jumps
    }
    const mid = alpha(vignetteAt(hm(20)));
    expect(mid).toBeGreaterThan(alpha(dusk));
    expect(mid).toBeLessThan(alpha(night));
  });

  it('wraps around midnight and handles out-of-range minutes', () => {
    expect(vignetteAt(hm(24 + 12))).toBe(vignetteAt(hm(12)));
    expect(vignetteAt(-60)).toBe(vignetteAt(hm(23)));
  });

  it('mixes and names moods', () => {
    expect(mixVignette('day', 'night', 0)).toBe('rgba(5, 8, 12, 0.32)');
    expect(mixVignette('day', 'night', 1)).toBe('rgba(5, 8, 12, 0.55)');
    expect(moodAt(hm(12))).toBe('day');
    expect(moodAt(hm(19, 40))).toBe('dusk');
    expect(moodAt(hm(23))).toBe('night');
  });

  it('writes --hud-vignette on the root', () => {
    const root = document.createElement('div');
    applyVignetteAt(root, hm(19, 30));
    expect(root.style.getPropertyValue('--hud-vignette')).toBe('rgba(5, 8, 12, 0.33)');
  });

  it('toggles the reduced / full motion classes', () => {
    const root = document.createElement('div');
    setHudMotion(root, 'reduced');
    expect(root.className).toBe('dz-reduced-motion');
    setHudMotion(root, 'full');
    expect(root.className).toBe('dz-full-motion');
    setHudMotion(root, 'auto');
    expect(root.className).toBe('');
  });
});

describe('chip set per mood (Designer, final fix 1)', () => {
  it('setHudMood switches chips: day → day set, dusk and night → night set', () => {
    const root = document.createElement('div');
    setHudMood(root, 'day');
    expect(root.dataset.hudChips).toBe('day');
    setHudMood(root, 'dusk');
    expect(root.dataset.hudChips).toBe('night');
    setHudMood(root, 'night');
    expect(root.dataset.hudChips).toBe('night');
  });

  it('game time: day set from the dawn keyframe to the dusk keyframe', () => {
    expect(chipModeAt(hm(5))).toBe('night');
    expect(chipModeAt(hm(5, 44))).toBe('night');
    expect(chipModeAt(hm(5, 45))).toBe('day');
    expect(chipModeAt(hm(12))).toBe('day');
    expect(chipModeAt(hm(19))).toBe('day');
    expect(chipModeAt(hm(19, 30))).toBe('night');
    expect(chipModeAt(hm(23))).toBe('night');
    const root = document.createElement('div');
    applyVignetteAt(root, hm(12));
    expect(root.dataset.hudChips).toBe('day');
    applyVignetteAt(root, hm(22));
    expect(root.dataset.hudChips).toBe('night');
  });
});
