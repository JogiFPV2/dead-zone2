import type { CharacterView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { weaponLoadout } from './loadout.js';

describe('loadout left hand (equippedSecondary, protocol 48)', () => {
  it('carries the left-hand item id', () => {
    const c = {
      equippedPrimary: null,
      equippedSecondary: 'base:flashlight',
      equippedBack: null,
      weaponKind: 'unarmed',
      twoHanded: false,
    } as unknown as CharacterView;
    expect(weaponLoadout(c, new Map()).left).toBe('base:flashlight');
    expect(weaponLoadout({ ...c, equippedSecondary: null }, new Map()).left).toBeUndefined();
  });
});
