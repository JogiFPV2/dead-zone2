import type { DeepReadonly } from '../bundle/deep-freeze.js';
import type { LootTable } from '../schemas/loot-table.js';

/** Id przedmiotów osiągalnych z tabeli, także przez zagnieżdżone tabele (cykle pomija). */
export function reachableLootItems(
  tables: Readonly<Record<string, LootTable | DeepReadonly<LootTable>>>,
  id: string,
  seen: Set<string> = new Set(),
): Set<string> {
  const out = new Set<string>();
  if (seen.has(id)) return out;
  seen.add(id);
  for (const e of tables[id]?.entries ?? []) {
    if ('item' in e) out.add(e.item);
    else for (const x of reachableLootItems(tables, e.table, seen)) out.add(x);
  }
  return out;
}
