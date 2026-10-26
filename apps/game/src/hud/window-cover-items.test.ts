import type { ItemView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { InventoryState } from '../state/game-state.js';
import { coverChoices } from './window-cover-items.js';

const item = (id: number, def: string): ItemView => ({ id, def, count: 1, weightKg: 1 });
const box = (id: number, items: ItemView[]) => ({
  id,
  kind: 'inventory' as const,
  capacityKg: null,
  weightKg: 0,
  items,
});
const covers = new Set(['base:blanket', 'base:jacket', 'base:curtain', 'base:tarp']);

describe('coverChoices (window „Zasłoń…” picker)', () => {
  it('carried windowCover items, one per type, main inventory first, worn clothes skipped', () => {
    const inv = {
      container: 1,
      loadKg: 0,
      capacityKg: 20,
      hardLimitKg: 40,
      carryLoad: 0,
      equipped: { torso: 3 },
      containers: {
        2: box(2, [item(7, 'base:tarp'), item(8, 'base:blanket')]),
        1: box(1, [item(3, 'base:jacket'), item(4, 'base:axe'), item(5, 'base:blanket')]),
      },
    } as unknown as InventoryState;
    expect(
      coverChoices(
        inv,
        (d) => covers.has(d),
        (d) => d.slice(5),
      ),
    ).toEqual([
      { id: 5, label: 'blanket' },
      { id: 7, label: 'tarp' },
    ]);
  });
  it('no inventory: nothing', () => {
    expect(coverChoices(undefined, () => true)).toEqual([]);
  });
});
