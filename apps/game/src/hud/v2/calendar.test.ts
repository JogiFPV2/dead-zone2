import { describe, expect, it } from 'vitest';
import { clockTime, gameDate } from './calendar.js';
import { hud2Scale } from './scale.js';

describe('top bar calendar', () => {
  it('day 12 is 14 July 1993 (mockup), months roll over', () => {
    expect(gameDate(12)).toBe('14 lipca 1993');
    expect(gameDate(1)).toBe('3 lipca 1993');
    expect(gameDate(30)).toBe('1 sierpnia 1993');
  });

  it('formats the clock', () => {
    expect(clockTime(14 * 60 + 32)).toBe('14:32');
    expect(clockTime(5)).toBe('00:05');
    expect(clockTime(1440 + 61.7)).toBe('01:01');
  });
});

describe('hud2Scale', () => {
  it('is 1 at the 1280×720 reference, clamped 0.8–1.5', () => {
    expect(hud2Scale(1280, 720)).toBe(1);
    expect(hud2Scale(1920, 1080)).toBe(1.5);
    expect(hud2Scale(800, 600)).toBe(0.8);
    expect(hud2Scale(1600, 720)).toBe(1);
  });
});
