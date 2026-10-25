import { describe, expect, it } from 'vitest';
import { FADE_MS, occludesPlayer, stepFade, type FadeView } from './wall-fade.js';

// Camera toward +y (yaw 0: offset (sin 0, cos 0) = (0, 1)).
const v: FadeView = { px: 10, py: 10, yaw: 0, z: 0 };

describe('occludesPlayer', () => {
  it('a wall 1.5 m in front toward the camera fades', () => {
    expect(occludesPlayer(v, 9, 11.5, 11, 11.5)).toBe(true);
  });
  it('a wall behind the player (away from the camera) does not', () => {
    expect(occludesPlayer(v, 9, 8.5, 11, 8.5)).toBe(false);
  });
  it('a camera-side wall of the neighbouring room (off the corridor) does not', () => {
    expect(occludesPlayer(v, 12, 11.5, 14, 11.5)).toBe(false);
  });
  it('beyond 3 m it does not; hysteresis keeps a fading one up to 3.5 m', () => {
    expect(occludesPlayer(v, 9, 13.3, 11, 13.3)).toBe(false);
    expect(occludesPlayer(v, 9, 13.3, 11, 13.3, true)).toBe(true);
  });
});

describe('stepFade', () => {
  it('takes FADE_MS across the full range, both ways', () => {
    expect(stepFade(1, 0, FADE_MS / 2)).toBeCloseTo(0.5);
    expect(stepFade(0.15, 1, FADE_MS)).toBe(1);
  });
});
