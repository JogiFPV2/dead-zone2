import { describe, expect, it } from 'vitest';
import { TICK_MS } from './constants.js';
import { FixedStepLoop } from './loop.js';

function setup() {
  let ticks = 0;
  const loop = new FixedStepLoop({ step: () => ticks++ });
  return { loop, ticks: () => ticks };
}

const runFor = (loop: FixedStepLoop, ms: number, frameMs: number): void => {
  for (let t = 0; t < ms; t += frameMs) loop.advance(frameMs);
};

describe('FixedStepLoop', () => {
  it('uses a fixed 50 ms step', () => {
    expect(TICK_MS).toBe(50);
  });

  it.each([
    [1, 20],
    [2, 40],
    [4, 80],
  ] as const)('runs %ix speed as %i ticks per real second', (speed, expected) => {
    const { loop, ticks } = setup();
    loop.setSpeed(speed);
    runFor(loop, 1000, 25);
    expect(ticks()).toBe(expected);
  });

  it('accumulates sub-tick frames', () => {
    const { loop, ticks } = setup();
    for (let i = 0; i < 4; i++) loop.advance(12.5);
    expect(ticks()).toBe(1);
    loop.advance(30);
    expect(ticks()).toBe(1);
    expect(loop.alpha).toBeCloseTo(0.6);
  });

  it('does not tick or accumulate while paused', () => {
    const { loop, ticks } = setup();
    loop.advance(100);
    loop.pause();
    expect(loop.advance(1000)).toBe(0);
    expect(ticks()).toBe(2);
    loop.resume();
    loop.advance(50);
    expect(ticks()).toBe(3);
  });

  it('caps ticks per advance and drops the excess', () => {
    const { loop, ticks } = setup();
    expect(loop.advance(10_000)).toBe(5);
    expect(loop.accumulatorMs).toBeLessThan(TICK_MS);
    loop.setSpeed(4);
    expect(loop.advance(10_000)).toBe(20);
    expect(ticks()).toBe(25);
  });

  it('ignores negative and NaN deltas', () => {
    const { loop, ticks } = setup();
    loop.advance(-100);
    loop.advance(Number.NaN);
    expect(ticks()).toBe(0);
    expect(loop.accumulatorMs).toBe(0);
  });
});
