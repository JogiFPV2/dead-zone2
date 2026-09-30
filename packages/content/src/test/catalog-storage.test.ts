import { describe, expect, it } from 'vitest';
import { baseBundle } from './base-bundle.js';

describe('torby i schowki', () => {
  const PROGRESSION = [
    'plastic-bag',
    'garbage-bag',
    'tote-bag',
    'school-backpack',
    'duffel-bag',
    'hiking-bag',
    'big-hiking-bag',
    'military-backpack',
  ];

  it('pojemność i redukcja wagi rosną od reklamówki do plecaka wojskowego', async () => {
    const b = await baseBundle();
    const bags = PROGRESSION.map((id) => b.items[`base:${id}`]);
    const stats = bags.map((x) => (x?.kind === 'container' ? x.bag : undefined));
    expect(stats.every(Boolean)).toBe(true);
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i]!.capacityKg, PROGRESSION[i]).toBeGreaterThan(stats[i - 1]!.capacityKg);
      expect(stats[i]!.weightReductionPct).toBeGreaterThan(stats[i - 1]!.weightReductionPct);
    }
  });

  it('część toreb nosi się w rękach, plecaki na plecach, saszetkę na pasku', async () => {
    const b = await baseBundle();
    const slots = (id: string) => {
      const x = b.items[`base:${id}`];
      return x?.kind === 'container' ? x.bag.slots : [];
    };
    for (const id of ['plastic-bag', 'garbage-bag', 'tote-bag']) {
      expect(slots(id)).toEqual(['hand_primary', 'hand_secondary']);
    }
    for (const id of ['school-backpack', 'hiking-bag', 'military-backpack']) {
      expect(slots(id)).toEqual(['back']);
    }
    expect(slots('fanny-pack')).toEqual(['belt']);
  });

  it('ma typy schowków z planu, a lodówka i zamrażarka spowalniają psucie', async () => {
    const b = await baseBundle();
    const ids = [
      'kitchen-counter',
      'wardrobe',
      'dresser',
      'fridge',
      'freezer',
      'crate',
      'metal-shelf',
      'car-trunk',
      'wooden-crate',
    ];
    expect(ids.filter((id) => !b.containers[`base:${id}`])).toEqual([]);
    const f = (id: string) => b.containers[`base:${id}`]?.spoilageMultiplier ?? 1;
    expect(f('freezer')).toBeLessThan(f('fridge'));
    expect(f('fridge')).toBeLessThan(1);
    expect(b.containers['base:wooden-crate']?.pickupItem).toBe('base:wooden-crate');
  });
});
