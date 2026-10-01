import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounced } from './debounce.js';

afterEach(() => vi.useRealTimers());

describe('debounced', () => {
  it('fires once with the latest value after the quiet period', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounced(400, fn);
    d(1);
    vi.advanceTimersByTime(300);
    d(2);
    vi.advanceTimersByTime(399);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
  });
});
