import { describe, expect, it } from 'vitest';
import { firstEnabled, menuScale, sliderAt, sliderKey, stepFocus } from './menu-model.js';

describe('menu model', () => {
  const items = [{ disabled: true }, {}, {}, { disabled: true }, {}];

  it('moves focus with wrapping and skips disabled items', () => {
    expect(firstEnabled(items)).toBe(1);
    expect(stepFocus(items, 2, 1)).toBe(4);
    expect(stepFocus(items, 4, 1)).toBe(1);
    expect(stepFocus(items, 1, -1)).toBe(4);
    expect(stepFocus([{ disabled: true }], 0, 1)).toBe(0);
  });

  it('steps sliders by 5, 1 with Shift and jumps with Home/End', () => {
    expect(sliderKey(0.45, 'ArrowRight', false)).toBe(0.5);
    expect(sliderKey(0.45, 'ArrowLeft', true)).toBe(0.44);
    expect(sliderKey(0.02, 'ArrowLeft', false)).toBe(0);
    expect(sliderKey(0.99, 'ArrowRight', false)).toBe(1);
    expect(sliderKey(0.5, 'Home', false)).toBe(0);
    expect(sliderKey(0.5, 'End', false)).toBe(1);
    expect(sliderKey(0.5, 'Enter', false)).toBeUndefined();
  });

  it('maps pointer x to a slider value and scales the layout', () => {
    expect(sliderAt(150, 100, 200)).toBe(0.25);
    expect(sliderAt(50, 100, 200)).toBe(0);
    expect(menuScale(1920, 1080)).toBe(1);
    expect(menuScale(1280, 720)).toBeCloseTo(2 / 3);
  });
});
