import { describe, expect, it } from 'vitest';
import type { CharacterView } from './views.js';

describe('CharacterView (protocol 48)', () => {
  it('carries the left hand: equippedSecondary (content id or null)', () => {
    const v: CharacterView = {
      stableId: 1,
      equippedPrimary: 'base:knife',
      equippedBack: null,
      equippedSecondary: 'base:flashlight',
      weaponKind: 'blade',
      twoHanded: false,
      sneaking: false,
      stepNoiseTiles: 0,
    };
    const empty: CharacterView = { ...v, equippedSecondary: null };
    expect((JSON.parse(JSON.stringify(v)) as CharacterView).equippedSecondary).toBe(
      'base:flashlight',
    );
    expect((JSON.parse(JSON.stringify(empty)) as CharacterView).equippedSecondary).toBeNull();
  });
});
