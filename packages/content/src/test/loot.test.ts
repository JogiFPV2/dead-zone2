import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../bundle/content-bundle.js';
import { baseBundle } from './base-bundle.js';

type Tables = ContentBundle['lootTables'];

/** Przedmioty osiągalne z tabeli (także przez zagnieżdżone tabele). */
function reachable(tables: Tables, id: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(id)) return out;
  seen.add(id);
  for (const e of tables[id]?.entries ?? []) {
    if ('item' in e) out.add(e.item);
    else for (const x of reachable(tables, e.table, seen)) out.add(x);
  }
  return out;
}

/** Tabele, od których zaczyna się losowanie: przypięte do pomieszczeń albo domyślne schowków. */
function rootTables(b: ContentBundle): string[] {
  const roots = Object.values(b.lootTables)
    .filter((t) => t.rooms.length > 0)
    .map((t) => t.id);
  for (const c of Object.values(b.containers))
    if (c.defaultLootTable) roots.push(c.defaultLootTable);
  return roots;
}

describe('loot tables paczki bazowej', () => {
  it('pokrywają uzgodnione typy pomieszczeń', async () => {
    const b = await baseBundle();
    const rooms = new Set(Object.values(b.lootTables).flatMap((t) => t.rooms));
    for (const r of [
      'kitchen',
      'garage',
      'bedroom',
      'gas-station',
      'police',
      'gun-store',
      'school',
      'warehouse',
    ]) {
      expect(rooms.has(`base:room-${r}`), r).toBe(true);
    }
  });

  it('każda broń, torba, pudełko i magazynek może się pojawić (poza craftowanymi)', async () => {
    const b = await baseBundle();
    const all = new Set(rootTables(b).flatMap((t) => [...reachable(b.lootTables, t)]));
    const kinds = ['weapon_melee', 'weapon_ranged', 'container', 'ammo_box', 'magazine'];
    const missing = Object.values(b.items)
      .filter((i) => kinds.includes(i.kind) && !i.tags.includes('base:weapon-crafted'))
      .filter((i) => i.id !== 'base:broken-bottle' && !all.has(i.id))
      .map((i) => i.id);
    expect(missing).toEqual([]);
  });

  it('para (pomieszczenie, schowek) wybiera najwyżej jedną tabelę', async () => {
    const b = await baseBundle();
    const tables = Object.values(b.lootTables);
    const rooms = new Set(tables.flatMap((t) => t.rooms));
    for (const room of rooms) {
      for (const c of Object.keys(b.containers)) {
        const hits = tables.filter(
          (t) => t.rooms.includes(room) && (t.containers.length === 0 || t.containers.includes(c)),
        );
        expect(hits.length, `${room} + ${c}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('domyślna tabela schowka go obejmuje, a rzadkie wpisy mają małą wagę', async () => {
    const b = await baseBundle();
    for (const c of Object.values(b.containers)) {
      const t = c.defaultLootTable ? b.lootTables[c.defaultLootTable] : undefined;
      if (t && t.containers.length > 0) expect(t.containers, c.id).toContain(c.id);
    }
    for (const t of Object.values(b.lootTables)) {
      const common = Math.max(
        ...t.entries.filter((e) => e.rarity === 'common').map((e) => e.weight),
      );
      for (const e of t.entries.filter((x) => x.rarity === 'rare' || x.rarity === 'very_rare')) {
        expect(e.weight, t.id).toBeLessThanOrEqual(Math.min(3, common));
      }
    }
  });
});
