import { weatherAt } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { precipitation } from './weather-fx.js';

describe('precipitation strength from the weather view', () => {
  it('rain, storm, snow; none for fog or clear; blends in a transition', () => {
    const at = (k: Parameters<typeof weatherAt>[3]) =>
      precipitation(weatherAt(1, 600, undefined, k));
    expect(at('rain')).toEqual({ rain: 0.6, snow: 0 });
    expect(at('storm')).toEqual({ rain: 1, snow: 0 });
    expect(at('snow')).toEqual({ rain: 0, snow: 1 });
    expect(at('fog')).toEqual({ rain: 0, snow: 0 });
    expect(precipitation(undefined)).toEqual({ rain: 0, snow: 0 });
    const half = precipitation({
      ...weatherAt(1, 600, undefined, 'storm'),
      from: 'clear',
      blend: 0.5,
    });
    expect(half.rain).toBeCloseTo(0.5, 5);
  });
});
