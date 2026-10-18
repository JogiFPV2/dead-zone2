import { describe, expect, it } from 'vitest';
import { CORE_STATS } from '../schemas/common/stat.js';
import { MOODLE_TEXTS_PL, moodleLevelPl, moodleNamePl } from '../i18n/moodle-texts.js';
import { baseBundle } from './base-bundle.js';

describe('moodle base:dirty (higiena, Symulacja #248)', () => {
  it('stat dirt jest w CORE_STATS, moodle 4 poziomy 25/50/75/90 z histerezą 5', async () => {
    expect(CORE_STATS).toContain('dirt');
    const m = (await baseBundle()).moodles['base:dirty']!;
    expect(m.stat).toBe('dirt');
    expect(m.polarity).toBe('negative');
    expect(m.maxLevel).toBe(4);
    expect(m.levels.map((l) => l.enterAt)).toEqual([25, 50, 75, 90]);
    expect(m.levels.map((l) => l.exitAt)).toEqual([20, 45, 70, 85]);
  });

  it('teksty PL: nazwa i każdy poziom', async () => {
    const m = (await baseBundle()).moodles['base:dirty']!;
    expect(moodleNamePl('base:dirty')).toBe('Brud');
    expect(MOODLE_TEXTS_PL['base:dirty'].levels).toHaveLength(m.maxLevel);
    expect(m.levels.map((_, i) => moodleLevelPl('base:dirty', i + 1))).toEqual([
      'Brudny',
      'Bardzo brudny',
      'Umorusany',
      'Cuchnący',
    ]);
    expect(moodleLevelPl('base:dirty', 5)).toBeUndefined();
    expect(moodleNamePl('base:unknown')).toBeUndefined();
  });
});
