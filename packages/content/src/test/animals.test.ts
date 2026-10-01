import { describe, expect, it } from 'vitest';
import { AnimalTypeSchema } from '../schemas/animal-type.js';
import { validatePacks } from '../validate/validate-packs.js';
import { baseBundle } from './base-bundle.js';
import { miniBase } from './helpers.js';

const minimal = {
  id: 'base:a',
  name: 'animal.base.a.name',
  health: 5,
  speed: { wanderTilesPerSec: 1, fleeTilesPerSec: 4 },
  sightRangeTiles: 10,
  hearingRangeTiles: 10,
  fleeDistanceTiles: 6,
  safeDistanceTiles: 12,
};

describe('zwierzęta', () => {
  it('schemat: domyślne wartości i przedziały min ≤ max', () => {
    const a = AnimalTypeSchema.parse(minimal);
    expect(a).toMatchObject({
      radiusTiles: 0.25,
      fearsZombies: true,
      fliesAway: false,
      huntable: false,
      habitat: 'any',
      loot: [],
    });
    expect(AnimalTypeSchema.safeParse({ ...minimal, habitat: 'sea' }).success).toBe(false);
    const bad = { ...minimal, grazeSec: { min: 5, max: 1 } };
    expect(AnimalTypeSchema.safeParse(bad).success).toBe(false);
  });

  it('walidator: loot musi wskazywać istniejący przedmiot', () => {
    const a = { ...minimal, loot: [{ item: 'base:nope' }] };
    const r = validatePacks([miniBase({ 'animal-types/a.json': a })]);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual([['missing_ref', '$.loot[0].item']]);
  });

  it('paczka bazowa: 6 typów, łowne królik i sarna, habitaty, ptak odlatuje, pies szczeka', async () => {
    const b = await baseBundle();
    const t = b.animalTypes;
    expect(Object.keys(t).sort()).toEqual(
      ['base:bird', 'base:cat', 'base:deer', 'base:dog', 'base:rabbit', 'base:squirrel'].sort(),
    );
    expect(
      Object.values(t)
        .filter((a) => a.huntable)
        .map((a) => a.id)
        .sort(),
    ).toEqual(['base:deer', 'base:rabbit']);
    expect(t['base:rabbit']?.loot).toEqual([
      { item: 'base:rabbit-carcass', count: { min: 1, max: 1 }, chance: 1 },
    ]);
    expect(t['base:deer']?.loot.map((l) => l.item)).toEqual(['base:venison', 'base:deer-hide']);
    expect(t['base:deer']?.habitat).toBe('wild');
    expect(t['base:dog']?.habitat).toBe('town');
    expect(t['base:cat']?.habitat).toBe('town');
    expect(t['base:bird']?.fliesAway).toBe(true);
    expect(t['base:dog']?.fleeNoise?.radiusTiles).toBeGreaterThan(10);
    for (const a of Object.values(t)) {
      expect(a.safeDistanceTiles).toBeGreaterThan(a.fleeDistanceTiles);
      expect(a.speed.fleeTilesPerSec).toBeGreaterThan(a.speed.wanderTilesPerSec);
    }
    expect(b.items['base:venison']?.kind).toBe('food');
    expect(b.items['base:deer-hide']?.kind).toBe('material');
  });
});
