import { describe, expect, it } from 'vitest';
import { lootCategoryOf } from '../loot/loot-category-of.js';
import { reachableLootItems } from '../loot/reachable-items.js';
import { baseBundle } from './base-bundle.js';
import { ITEM_EXCEPTIONS, TABLE_EXCEPTIONS } from './container-loot-allowlist.js';
import { lootSpots, pickTable as pick, PLAYER_BUILT } from './container-loot-pairs.js';

describe('loot schowków: każdy mebel ma realistyczną zawartość', () => {
  it('każdy schowek deklaruje lootAccepts, a każdy poza stawianymi przez gracza ma własną tabelę', async () => {
    const b = await baseBundle();
    const noAccepts = Object.values(b.containers)
      .filter((c) => !c.lootAccepts?.length)
      .map((c) => c.id);
    expect(noAccepts).toEqual([]);
    const noTable = Object.values(b.containers)
      .filter((c) => !c.tags.includes(PLAYER_BUILT) && !c.defaultLootTable)
      .map((c) => c.id);
    expect(noTable).toEqual([]);
  });

  it('żaden przedmiot nie ląduje w złym schowku ani w złym pomieszczeniu', async () => {
    const b = await baseBundle();
    const rooms = b.worldSettings.loot.roomAccepts as Readonly<Record<string, readonly string[]>>;
    const bad = new Set<string>();
    const used = new Set<object>();
    const ok = (at: string, item: string, accepts: readonly string[], cat: string) => {
      if (accepts.includes(cat)) return true;
      const ex = ITEM_EXCEPTIONS.find((x) => x.at === at && x.item === item);
      if (ex) used.add(ex);
      return ex !== undefined;
    };
    for (const { table, container, room } of lootSpots(b)) {
      const tex = TABLE_EXCEPTIONS.find((x) => x.table === table && x.container === container);
      if (tex) used.add(tex);
      for (const item of reachableLootItems(b.lootTables, table)) {
        const cat = lootCategoryOf(b.items[item]!);
        const accepts = container ? (b.containers[container]!.lootAccepts ?? []) : undefined;
        if (container && accepts && !tex && !ok(container, item, accepts, cat))
          bad.add(`${table} → ${container}: ${item} (${cat})`);
        if (room && !ok(room, item, rooms[room] ?? [], cat))
          bad.add(`${table} → ${room}: ${item} (${cat})`);
      }
    }
    expect([...bad]).toEqual([]);
    const stale = [...ITEM_EXCEPTIONS, ...TABLE_EXCEPTIONS].filter((x) => !used.has(x));
    expect(stale).toEqual([]);
  });

  it('lodówka ma jedzenie i napoje, szafa ubrania, apteczka leki — bez broni', async () => {
    const b = await baseBundle();
    const cats = (table: string) =>
      new Set(
        [...reachableLootItems(b.lootTables, table)].map((id) => lootCategoryOf(b.items[id]!)),
      );
    expect([...cats('base:kitchen-fridge')].sort()).toEqual(['drink', 'food-fresh']);
    expect(cats('base:kitchen').has('food-canned')).toBe(true);
    expect(cats('base:wardrobe').has('clothing')).toBe(true);
    expect(cats('base:bathroom').has('medical')).toBe(true);
    expect(cats('base:living-room').has('vhs')).toBe(true);
    expect(cats('base:toolbox').has('tool')).toBe(true);
    for (const t of ['base:kitchen-fridge', 'base:freezer', 'base:wardrobe', 'base:bathroom'])
      for (const bad of ['weapon', 'firearm', 'sport'])
        expect(cats(t).has(bad as never), `${t}: ${bad}`).toBe(false);
  });

  it('pojemnik wygrywa z ogólną tabelą pomieszczenia, pomieszczenie może go podmienić', async () => {
    const b = await baseBundle();
    expect(pick(b, 'base:fridge', 'base:room-kitchen')).toBe('base:kitchen-fridge');
    expect(pick(b, 'base:fridge', 'base:room-shop')).toBe('base:shop-fridge');
    expect(pick(b, 'base:fridge', 'base:room-living-room')).toBe('base:kitchen-fridge');
    expect(pick(b, 'base:kitchen-cabinet', 'base:room-kitchen')).toBe('base:kitchen');
    expect(pick(b, 'base:kitchen-counter', 'base:room-kitchen')).toBe('base:kitchen-drawer');
    expect(pick(b, 'base:freezer', 'base:room-kitchen')).toBe('base:freezer');
    expect(pick(b, 'base:wardrobe', 'base:room-bedroom')).toBe('base:wardrobe');
    expect(pick(b, 'base:bookshelf', 'base:room-living-room')).toBe('base:bookshelf');
    expect(pick(b, 'base:tool-chest', 'base:room-garage')).toBe('base:toolbox');
    expect(pick(b, 'base:bathroom-cabinet', undefined)).toBe('base:bathroom');
    expect(pick(b, 'base:dresser', 'base:room-bedroom')).toBe('base:bedroom');
  });
});
