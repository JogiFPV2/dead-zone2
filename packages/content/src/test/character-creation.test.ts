import { describe, expect, it } from 'vitest';
import { REQUIRED_APPEARANCE_SLOTS } from '../schemas/appearance-part.js';
import { validatePacks } from '../validate/validate-packs.js';
import { baseBundle } from './base-bundle.js';
import { miniBase } from './helpers.js';

const pal = (id: string, kind: string, colors = ['a', 'b']) => ({
  id,
  name: `palette.${id.replace(':', '.')}.name`,
  kind,
  colors: colors.map((c) => ({ id: c, hex: '#112233' })),
});
const part = (slot: string, palette?: string) => ({
  id: `base:${slot}-1`,
  name: `appearance.base.${slot}-1.name`,
  slot,
  modelRef: `char/${slot}-1`,
  tints: palette ? [{ channel: 'primary', palette }] : [],
});
const parts = REQUIRED_APPEARANCE_SLOTS.map((s) =>
  part(s, s === 'face' ? undefined : s === 'hair' ? 'base:hair' : 'base:cloth'),
);
const choice = (slot: string, color?: string) => ({
  part: `base:${slot}-1`,
  ...(color ? { colors: { primary: color } } : {}),
});
const appearance = {
  skin: 'a',
  parts: {
    face: choice('face'),
    hair: choice('hair', 'a'),
    top: choice('top', 'a'),
    bottom: choice('bottom', 'b'),
    shoes: choice('shoes', 'a'),
  },
};
const run = (files: Record<string, unknown>, cc: Record<string, unknown> = {}) =>
  validatePacks([
    miniBase({
      'palettes/p.json': [
        pal('base:skin', 'skin'),
        pal('base:hair', 'hair'),
        pal('base:cloth', 'cloth'),
      ],
      'appearance-parts/p.json': parts,
      'world-settings.json': { characterCreation: { defaultAppearance: appearance, ...cc } },
      ...files,
    }),
  ]).errors.map((e) => [e.code, e.path]);

describe('tworzenie postaci: wygląd, palety, pula punktów', () => {
  it('poprawny zestaw przechodzi', () => {
    expect(run({})).toEqual([]);
  });

  it('brak palety, zły rodzaj palety, powtórzony kolor, pusty slot', () => {
    const bad = [
      ...parts.filter((p) => p.slot !== 'shoes'),
      part('beard', 'base:cloth'),
      { ...part('top', 'base:nope'), id: 'base:top-2' },
    ];
    const pals = [
      pal('base:skin', 'skin', ['a', 'a']),
      pal('base:hair', 'hair'),
      pal('base:cloth', 'cloth'),
    ];
    const errs = run({ 'appearance-parts/p.json': bad, 'palettes/p.json': pals });
    expect(errs).toEqual(
      expect.arrayContaining([
        ['missing_ref', '$[5].tints[0].palette'],
        ['palette_duplicate_color', '$[0].colors[1].id'],
        ['appearance_palette_kind', '$[4].tints[0].palette'],
        ['appearance_slot_empty', '$.characterCreation'],
      ]),
    );
  });

  it('koszty i wygląd startowy muszą być spójne', () => {
    const wrong = {
      ...appearance,
      skin: 'zzz',
      parts: { ...appearance.parts, hair: choice('top', 'a'), top: choice('top', 'zzz') },
    };
    expect(
      run(
        {},
        { skillPointCost: [3, 1], name: { minLen: 30, maxLen: 24 }, defaultAppearance: wrong },
      ),
    ).toEqual([
      ['creation_cost_invalid', '$.characterCreation.skillPointCost'],
      ['creation_cost_invalid', '$.characterCreation.skillPointCost'],
      ['creation_cost_invalid', '$.characterCreation.name.minLen'],
      ['creation_default_invalid', '$.characterCreation.defaultAppearance.skin'],
      ['creation_default_invalid', '$.characterCreation.defaultAppearance.parts.hair.part'],
      ['creation_default_invalid', '$.characterCreation.defaultAppearance.parts.top.colors'],
    ]);
  });

  it('base: opcje w każdym slocie, palety 8/10/16, pula 8 i koszty 1/2/3', async () => {
    const b = await baseBundle();
    const count = (slot: string) =>
      Object.values(b.appearanceParts).filter((p) => p.slot === slot).length;
    expect([count('face'), count('hair'), count('top'), count('bottom'), count('shoes')]).toEqual([
      6, 8, 6, 5, 4,
    ]);
    expect(count('beard')).toBeGreaterThan(0);
    const colors = (id: string) => b.palettes[id]?.colors.length;
    expect([colors('base:skin'), colors('base:hair'), colors('base:cloth')]).toEqual([8, 10, 16]);
    const cc = b.worldSettings.characterCreation;
    expect(cc).toMatchObject({
      startPoints: 8,
      maxSkillLevelAtStart: 3,
      skillPointCost: [1, 2, 3],
    });
    expect(cc.name).toEqual({ minLen: 2, maxLen: 24 });
    expect(cc.defaultAppearance?.parts.hair.part).toBe('base:hair-short');
    for (const p of Object.values(b.appearanceParts)) expect(p.modelRef).toMatch(/^char\//);
  });
});
