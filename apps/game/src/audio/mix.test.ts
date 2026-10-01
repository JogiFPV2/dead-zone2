import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/schema.js';
import { busGains, masterGain, percent, volumeToGain } from './mix.js';

describe('audio mix', () => {
  it('uses a squared curve clamped to 0..1', () => {
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
  });

  it('silences master when muted and menu music when the toggle is off', () => {
    const a = DEFAULT_SETTINGS.audio;
    expect(masterGain(a)).toBeCloseTo(0.64);
    expect(masterGain({ ...a, muted: true })).toBe(0);
    expect(busGains({ ...a, menuMusic: false }, true).music).toBe(0);
    expect(busGains({ ...a, menuMusic: false }, false).music).toBeCloseTo(0.2025);
    expect(busGains(a, true).ambience).toBeCloseTo(0.49);
  });

  it('shows sliders as 0–100', () => {
    expect(percent(0.455)).toBe(46);
    expect(percent(DEFAULT_SETTINGS.audio.master)).toBe(80);
  });
});
