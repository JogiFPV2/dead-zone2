import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { craftItemName } from './crafting-labels.js';

const ANIMAL_ITEMS = {
  'base:venison': 'Surowa dziczyzna',
  'base:venison-steak': 'Stek z dziczyzny',
  'base:small-game-meat': 'Mięso z drobnej zwierzyny',
  'base:deer-hide': 'Skóra jelenia',
};

describe('animal loot (#88)', () => {
  it('has Polish names and baked icons', () => {
    const index = JSON.parse(
      readFileSync(new URL('../../public/icons/index.json', import.meta.url), 'utf8'),
    ) as Record<string, string>;
    for (const [id, name] of Object.entries(ANIMAL_ITEMS)) {
      expect(craftItemName(id)).toBe(name);
      expect(index[id]).toMatch(/\.png$/);
    }
  });
});
