import { describe, expect, it } from 'vitest';
import {
  SNEAK_CHIP,
  createShowTimer,
  hpLevel,
  problemMoodles,
  withSneakChip,
} from './hud3-model.js';

describe('problemMoodles', () => {
  const m = (id: string, polarity: 'pos' | 'neg', level: number, since = 0) =>
    ({ id, label: id, polarity, level, since }) as never;
  it('keeps negatives, shows positives only for 2.5 s', () => {
    const list = [m('pain', 'neg', 1), m('fed', 'pos', 1, 1000), m('none', 'neg', 0)];
    expect(problemMoodles(list, 2000).map((x: { id: string }) => x.id)).toEqual(['pain', 'fed']);
    expect(problemMoodles(list, 4000).map((x: { id: string }) => x.id)).toEqual(['pain']);
  });
});

describe('hpLevel', () => {
  it('uses the 30 / 15 thresholds', () => {
    expect(hpLevel(72)).toBe('ok');
    expect(hpLevel(30)).toBe('warning');
    expect(hpLevel(15)).toBe('danger');
  });
});

describe('createShowTimer', () => {
  it('shows after a change for the hold time, not at start', () => {
    const t = createShowTimer(2500);
    expect(t('a', 0)).toBe(false);
    expect(t('b', 100)).toBe(true);
    expect(t('b', 2500)).toBe(true);
    expect(t('b', 2700)).toBe(false);
    expect(t('b', 2700, true)).toBe(true);
  });
});

describe('sneak chip', () => {
  it('adds „Skradanie” only while sneaking', () => {
    expect(withSneakChip([], false)).toEqual([]);
    expect(withSneakChip([], true)).toEqual([SNEAK_CHIP]);
    expect(SNEAK_CHIP.label).toBe('Skradanie');
  });
});
