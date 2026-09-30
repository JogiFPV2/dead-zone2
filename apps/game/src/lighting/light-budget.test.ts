import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHT_BUDGET, selectLamps, type BudgetLamp } from './light-budget.js';

const lamp = (x: number, z: number, working = true): BudgetLamp => ({ x, z, working });
const budget = (maxLights: number, maxDistance = 100, hysteresis = 0) => ({
  maxLights,
  maxDistance,
  hysteresis,
});

describe('selectLamps', () => {
  const lamps = [lamp(10, 0), lamp(1, 0), lamp(0, 5), lamp(-3, 0), lamp(0, -20)];

  it('picks the nearest lamps, nearest first, up to the budget', () => {
    expect(selectLamps(lamps, 0, 0, budget(3))).toEqual([1, 3, 2]);
    expect(selectLamps(lamps, 0, 0, budget(10))).toEqual([1, 3, 2, 0, 4]);
    expect(selectLamps(lamps, 0, 0, budget(0))).toEqual([]);
  });

  it('skips broken lamps', () => {
    const withBroken = [lamp(1, 0, false), lamp(2, 0), lamp(3, 0)];
    expect(selectLamps(withBroken, 0, 0, budget(2))).toEqual([1, 2]);
  });

  it('ignores lamps beyond maxDistance', () => {
    expect(selectLamps(lamps, 0, 0, budget(10, 6))).toEqual([1, 3, 2]);
  });

  it('breaks distance ties by index (deterministic)', () => {
    const ring = [lamp(0, 2), lamp(2, 0), lamp(-2, 0), lamp(0, -2)];
    expect(selectLamps(ring, 0, 0, budget(2))).toEqual([0, 1]);
  });

  it('keeps a lit lamp until a candidate is clearly closer (hysteresis)', () => {
    const pair = [lamp(0, 0), lamp(10, 0)];
    const b = budget(1, 100, 2);
    // Focus just past the midpoint: lamp 1 is closer by 1, less than the hysteresis.
    expect(selectLamps(pair, 5.5, 0, b, [0])).toEqual([0]);
    // Clearly closer: switch.
    expect(selectLamps(pair, 7, 0, b, [0])).toEqual([1]);
    // Without history the nearest wins.
    expect(selectLamps(pair, 5.5, 0, b)).toEqual([1]);
  });

  it('default budget stays small (performance)', () => {
    expect(DEFAULT_LIGHT_BUDGET.maxLights).toBeLessThanOrEqual(4);
  });
});
