import { describe, expect, it } from 'vitest';
import { lootCategoryOf } from '../loot/loot-category-of.js';
import { reachableLootItems } from '../loot/reachable-items.js';
import { baseBundle } from './base-bundle.js';

/**
 * Myśliwy trzyma broń i amunicję w szafie albo skrzyni — jedyny wyjątek od `lootAccepts` w
 * dodatkach profili budynków.
 */
const HUNTER_OK = new Set(['firearm', 'ammo', 'weapon', 'bag', 'sport', 'tool']);

describe('charakter budynku i losowość łupu (worldSettings.loot)', () => {
  it('profile: zwykły i splądrowany są, wagi dają 100, dodatki wskazują istniejące tabele', async () => {
    const b = await baseBundle();
    const list = b.worldSettings.loot.buildingProfiles;
    const ids = list.map((p) => p.id);
    expect(ids).toContain('base:profile-normal');
    expect(ids).toContain('base:profile-looted');
    expect(list.reduce((s, p) => s + p.weight, 0)).toBe(100);
    const looted = list.find((p) => p.id === 'base:profile-looted')!;
    expect(looted.chancePct).toBeLessThan(100);
    for (const p of list)
      for (const x of p.extra) {
        expect(b.lootTables[x.table], `${p.id}: ${x.table}`).toBeDefined();
        for (const c of x.containers) expect(b.containers[c], `${p.id}: ${c}`).toBeDefined();
      }
  });

  it('dodatki profili trafiają tylko do pasujących mebli i pomieszczeń', async () => {
    const b = await baseBundle();
    const rooms = b.worldSettings.loot.roomAccepts as Readonly<Record<string, readonly string[]>>;
    const bad: string[] = [];
    for (const p of b.worldSettings.loot.buildingProfiles)
      for (const x of p.extra)
        for (const item of reachableLootItems(b.lootTables, x.table)) {
          const cat = lootCategoryOf(b.items[item]!);
          if (p.id === 'base:profile-hunter' && HUNTER_OK.has(cat)) continue;
          for (const c of x.containers)
            if (!(b.containers[c]!.lootAccepts ?? []).includes(cat))
              bad.push(`${p.id} → ${c}: ${item} (${cat})`);
          for (const r of x.rooms)
            if (!(rooms[r] ?? []).includes(cat)) bad.push(`${p.id} → ${r}: ${item} (${cat})`);
        }
    expect(bad).toEqual([]);
  });

  it('zużycie i podłoga: część łupu używana, w pokoju 1–3 rzeczy', async () => {
    const b = await baseBundle();
    const { wear, floorRoomItems } = b.worldSettings.loot;
    expect(wear.wornChance).toBeGreaterThan(0);
    expect(wear.wornChance).toBeLessThan(1);
    expect(wear.minPct).toBeLessThan(wear.maxPct);
    expect(wear.maxPct).toBeLessThan(100);
    expect(floorRoomItems).toEqual({ min: 1, max: 3 });
  });

  it('kościół, fabryka, remiza i aneks w biurze mają własny łup', async () => {
    const b = await baseBundle();
    for (const [table, room] of [
      ['base:church', 'base:room-church'],
      ['base:factory', 'base:room-factory'],
      ['base:fire-station', 'base:room-fire-station'],
      ['base:office-kitchenette', 'base:room-office'],
    ] as const)
      expect(b.lootTables[table]?.rooms, table).toContain(room);
  });

  it('każdy nowy przedmiot da się znaleźć', async () => {
    const b = await baseBundle();
    const all = new Set<string>();
    for (const t of Object.keys(b.lootTables))
      for (const i of reachableLootItems(b.lootTables, t)) all.add(i);
    for (const p of b.worldSettings.loot.buildingProfiles)
      for (const x of p.extra)
        for (const i of reachableLootItems(b.lootTables, x.table)) all.add(i);
    const fresh = [
      'base:luncheon-meat',
      'base:tourniquet',
      'base:oil-lamp',
      'base:hand-drill',
      'base:sandbag',
      'base:crossbow',
      'base:typewriter',
      'base:walkman',
      'base:cigarettes',
    ];
    expect(fresh.filter((id) => !all.has(id))).toEqual([]);
  });
});
