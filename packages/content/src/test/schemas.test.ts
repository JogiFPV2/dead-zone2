import { describe, expect, it } from 'vitest';
import { ConditionSchema } from '../schemas/common/condition.js';
import { MoodleSchema } from '../schemas/moodle.js';
import { TraitSchema } from '../schemas/trait/trait.js';

describe('MoodleSchema', () => {
  const moodle = {
    id: 'base:hunger',
    name: 'moodle.base.hunger.name',
    polarity: 'negative',
    maxLevel: 2,
    stat: 'hunger',
    levels: [
      { label: 'moodle.base.hunger.level-1', enterAt: 30, exitAt: 25 },
      { label: 'moodle.base.hunger.level-2', enterAt: 60, exitAt: 55 },
    ],
  };
  it('przyjmuje poprawny moodle', () => {
    expect(MoodleSchema.safeParse(moodle).success).toBe(true);
  });
  it('liczba poziomów musi równać się maxLevel', () => {
    expect(MoodleSchema.safeParse({ ...moodle, maxLevel: 3 }).success).toBe(false);
  });
  it('maxLevel 1–4 i polarity negative|positive', () => {
    expect(MoodleSchema.safeParse({ ...moodle, maxLevel: 5 }).success).toBe(false);
    expect(MoodleSchema.safeParse({ ...moodle, polarity: 'neutral' }).success).toBe(false);
  });
  it('pilnuje histerezy i kolejności progów', () => {
    const noHyst = { ...moodle, levels: [moodle.levels[0], { ...moodle.levels[1], exitAt: 70 }] };
    const res = MoodleSchema.safeParse(noHyst);
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['levels', 1, 'exitAt']);
    const unordered = { ...moodle, levels: [moodle.levels[1], moodle.levels[0]] };
    expect(MoodleSchema.safeParse(unordered).success).toBe(false);
  });
  it('direction falling odwraca progi (np. zimno)', () => {
    const cold = {
      ...moodle,
      stat: 'body-temperature-c',
      direction: 'falling',
      levels: [
        { label: 'moodle.base.cold.level-1', enterAt: 36, exitAt: 36.3 },
        { label: 'moodle.base.cold.level-2', enterAt: 35, exitAt: 35.3 },
      ],
    };
    expect(MoodleSchema.safeParse(cold).success).toBe(true);
  });
});

describe('modyfikatory i warunki', () => {
  it('przyjmuje deklaratywne warunki, także zagnieżdżone', () => {
    const ok = [
      { moodle: 'base:panic', minLevel: 2 },
      { skill: 'base:aiming', minLevel: 3 },
      { all: [{ trait: 'base:brave' }, { not: { stat: 'health', op: 'lte', value: 20 } }] },
    ];
    for (const c of ok) expect(ConditionSchema.safeParse(c).success).toBe(true);
  });
  it('odrzuca warunki z mieszanymi polami albo kodem', () => {
    expect(
      ConditionSchema.safeParse({ moodle: 'base:panic', minLevel: 2, skill: 'base:x' }).success,
    ).toBe(false);
    expect(ConditionSchema.safeParse({ code: 'player.hp < 10' }).success).toBe(false);
  });
  it('cecha: nieznana statystyka silnika odrzucona, statystyka moda (id) przyjęta', () => {
    const t = (stat: string) => ({
      id: 'base:t',
      name: 'trait.base.t.name',
      polarity: 'positive',
      cost: 1,
      modifiers: [{ stat, op: 'mul', value: 1.1 }],
    });
    expect(TraitSchema.safeParse(t('move-speed')).success).toBe(true);
    expect(TraitSchema.safeParse(t('my-mod:sanity')).success).toBe(true);
    expect(TraitSchema.safeParse(t('movespeed')).success).toBe(false);
  });
  it('cecha nie może kolidować sama ze sobą', () => {
    const t = {
      id: 'base:t',
      name: 'trait.base.t.name',
      polarity: 'negative',
      cost: -1,
      conflicts: ['base:t'],
    };
    expect(TraitSchema.safeParse(t).success).toBe(false);
  });
});
