import { describe, expect, it } from 'vitest';
import { createFpsMeter } from './fps.js';

describe('createFpsMeter', () => {
  it('returns 0 before two frames', () => {
    const m = createFpsMeter();
    expect(m.fps()).toBe(0);
    expect(m.tick(0)).toBe(0);
  });

  it('averages steady 60 fps', () => {
    const m = createFpsMeter(10);
    for (let i = 0; i <= 30; i++) m.tick((i * 1000) / 60);
    expect(m.fps()).toBeCloseTo(60, 6);
  });

  it('only considers the last N intervals', () => {
    const m = createFpsMeter(4);
    let t = 0;
    m.tick(t);
    for (let i = 0; i < 4; i++) m.tick((t += 100)); // 10 fps
    for (let i = 0; i < 4; i++) m.tick((t += 20)); // 50 fps
    expect(m.fps()).toBeCloseTo(50, 6);
  });
});
