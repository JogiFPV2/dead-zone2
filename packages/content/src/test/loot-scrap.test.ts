import { describe, expect, it } from 'vitest';
import { baseBundle } from './base-bundle.js';

/** Craft materials you find in Project Zomboid: sheet metal and scrap electronics in the garage and warehouse, glass in the trash. */
const EXPECTED: Record<string, string[]> = {
  'base:metal-sheet': ['base:garage', 'base:warehouse'],
  'base:electronics-scrap': ['base:garage', 'base:warehouse'],
  'base:glass-shards': ['base:trash'],
};

describe('złom i materiały w lootcie', () => {
  it('blacha, złom elektroniczny i szkło leżą tam, gdzie w PZ', async () => {
    const b = await baseBundle();
    for (const [item, tables] of Object.entries(EXPECTED))
      for (const t of tables) {
        const entries = b.lootTables[t]?.entries ?? [];
        expect(
          entries.some((e) => 'item' in e && e.item === item),
          `${item} w ${t}`,
        ).toBe(true);
      }
  });
});
