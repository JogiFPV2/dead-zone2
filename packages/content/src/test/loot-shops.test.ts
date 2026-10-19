import { describe, expect, it } from 'vitest';
import { baseBundle } from './base-bundle.js';

/** Project Zomboid style: loose rounds at the police and gun store, lighters and batteries at the gas station. */
const EXPECTED: Record<string, string[]> = {
  'base:police': ['base:ammo-9mm', 'base:shotgun-shell'],
  'base:gun-store': ['base:ammo-9mm', 'base:ammo-38', 'base:shotgun-shell'],
  'base:gas-station': ['base:lighter', 'base:matches', 'base:battery', 'base:flashlight'],
  'base:grocery': ['base:garbage-bag'],
};

describe('sklepy, stacja i policja: luźna amunicja i drobiazgi', () => {
  it('wpisy w tabelach lootu', async () => {
    const b = await baseBundle();
    for (const [table, items] of Object.entries(EXPECTED)) {
      const ids = new Set(
        (b.lootTables[table]?.entries ?? []).flatMap((e) => ('item' in e ? [e.item] : [])),
      );
      for (const id of items) expect(ids.has(id), `${id} w ${table}`).toBe(true);
    }
  });

  it('luźne naboje mieszczą się w jednym stosie', async () => {
    const b = await baseBundle();
    for (const table of ['base:police', 'base:gun-store'])
      for (const e of b.lootTables[table]!.entries) {
        if (!('item' in e) || b.items[e.item]?.kind !== 'ammo') continue;
        expect(e.count?.max ?? 1, e.item).toBeLessThanOrEqual(b.items[e.item]!.maxStack);
      }
  });
});
