import { expect, it } from 'vitest';
import { computeUiScale, isBelowMinResolution } from './ui-scale.js';

it('computes --ui-scale per spec §2', () => {
  expect(computeUiScale(1920, 1080)).toBe(1);
  expect(computeUiScale(1280, 720)).toBeCloseTo(0.8);
  expect(computeUiScale(1024, 600)).toBeCloseTo(0.8); // never below 0.8
  expect(computeUiScale(3840, 2160)).toBeCloseTo(1.5); // capped at 1.5
  expect(computeUiScale(2560, 1080)).toBe(1); // ultrawide: height decides
  expect(computeUiScale(1920, 1080, 1.3)).toBeCloseTo(1.3);
  expect(computeUiScale(1600, 900)).toBeCloseTo(0.85); // 0.833 → 0.85
});

it('flags resolutions below 1280×720', () => {
  expect(isBelowMinResolution(1280, 720)).toBe(false);
  expect(isBelowMinResolution(1279, 720)).toBe(true);
});
