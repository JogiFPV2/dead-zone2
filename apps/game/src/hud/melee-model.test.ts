import type { CombatView, MeleeWeaponView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { durabilityLevel, meleeVM } from './melee-model.js';

const melee = (over: Partial<MeleeWeaponView> = {}): MeleeWeaponView => ({
  source: 'improvised',
  damage: { min: 2, max: 4.5 },
  rangeTiles: 1.2,
  attacksPerSec: 1.1,
  staminaCost: 4,
  critChance: 0.05,
  twoHanded: false,
  skill: 'base:blunt',
  breakChancePct: 10,
  conditionPct: 72,
  ...over,
});

const combat = (
  weapon: string | null,
  m?: MeleeWeaponView,
  cond?: [number, number],
): CombatView => ({
  zombiesKilled: 0,
  weapon,
  condition: cond?.[0] ?? null,
  maxCondition: cond?.[1] ?? null,
  readyTick: 0,
  ...(m ? { melee: m } : {}),
});

const noCondition = (m: MeleeWeaponView): MeleeWeaponView => {
  const out: Partial<MeleeWeaponView> = { ...m };
  delete out.conditionPct;
  return out as MeleeWeaponView;
};

const name = (id: string) => ({ 'base:plank': 'Deska', 'base:stone': 'Kamień' })[id] ?? id;

describe('melee weapon panel model', () => {
  it('improvised plank: tag IMPROWIZOWANA, condition, stats', () => {
    expect(meleeVM(combat('base:plank', melee()), name)).toEqual({
      weapon: 'base:plank',
      name: 'Deska',
      source: 'improvised',
      tag: 'IMPROWIZOWANA',
      twoHanded: false,
      conditionPct: 72,
      level: 'ok',
      stats: 'OBR 2–4,5 · 1,1/s · 1,2 m',
    });
  });

  it('default item: PRZEDMIOT; two-handed flag', () => {
    const vm = meleeVM(combat('base:stone', melee({ source: 'default', twoHanded: true })), name);
    expect(vm).toMatchObject({ tag: 'PRZEDMIOT', twoHanded: true });
  });

  it('catalogue weapon: no tag; condition from condition / maxCondition', () => {
    const vm = meleeVM(combat('base:bat', noCondition(melee({ source: 'weapon' })), [3, 20]), name);
    expect(vm?.tag).toBeUndefined();
    expect(vm).toMatchObject({ conditionPct: 15, level: 'low' });
  });

  it('catalogue weapon of category improvised (stone, brick) is tagged IMPROWIZOWANA', () => {
    const cat = (id: string) => (id === 'base:stone' ? 'improvised' : 'blunt');
    expect(meleeVM(combat('base:stone', melee({ source: 'weapon' })), name, cat)?.tag).toBe(
      'IMPROWIZOWANA',
    );
    expect(
      meleeVM(combat('base:bat', melee({ source: 'weapon' })), name, cat)?.tag,
    ).toBeUndefined();
  });

  it('bare hands, firearm (no melee) and no view → no panel', () => {
    expect(meleeVM(combat(null, melee({ source: 'unarmed' })), name)).toBeUndefined();
    expect(meleeVM(combat('base:pistol'), name)).toBeUndefined();
    expect(meleeVM(undefined, name)).toBeUndefined();
  });

  it('bar turns red below 25 %', () => {
    expect(durabilityLevel(25)).toBe('mid');
    expect(durabilityLevel(24)).toBe('low');
    expect(durabilityLevel(51)).toBe('ok');
  });
});
