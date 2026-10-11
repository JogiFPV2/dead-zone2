import type { ContentBundle } from '../bundle/content-bundle.js';
import { lootTableForContainer } from '../loot/container-loot-table.js';

const PLAYER_BUILT = 'base:player-built';

/** Miejsce losowania: tabela w schowku (albo na podłodze) w pomieszczeniu (albo bez). */
export interface LootSpot {
  table: string;
  container?: string | undefined;
  room?: string | undefined;
}

export function pickTable(b: ContentBundle, container: string, room?: string): string | undefined {
  const tables = Object.keys(b.lootTables)
    .sort()
    .map((id) => b.lootTables[id]!);
  return lootTableForContainer(tables, (id) => b.lootTables[id], b.containers[container]!, room)
    ?.id;
}

/** Wszystkie miejsca, w których test sprawdza loot (schowek × pomieszczenie, podłoga). */
export function lootSpots(b: ContentBundle): LootSpot[] {
  const spots = new Map<string, LootSpot>();
  const add = (s: LootSpot) => spots.set(`${s.table}|${s.container}|${s.room}`, s);
  for (const c of Object.values(b.containers)) {
    if (c.defaultLootTable) add({ table: c.defaultLootTable, container: c.id });
    for (const room of c.placeIn ?? []) {
      const table = pickTable(b, c.id, room);
      if (table) add({ table, container: c.id, room });
    }
  }
  // Ogólne tabele pomieszczeń trafiają tylko do schowków bez własnej tabeli (stawiane przez
  // gracza są puste), a każda tabela pomieszczenia daje też loot na podłodze.
  const orphans = Object.values(b.containers).filter(
    (c) => !c.defaultLootTable && !c.tags.includes(PLAYER_BUILT),
  );
  for (const t of Object.values(b.lootTables)) {
    for (const room of t.rooms) {
      add({ table: t.id, room });
      const targets = t.containers.length > 0 ? t.containers : orphans.map((c) => c.id);
      for (const container of targets) add({ table: t.id, container, room });
    }
    if (t.rooms.length === 0) for (const container of t.containers) add({ table: t.id, container });
  }
  return [...spots.values()];
}

export { PLAYER_BUILT };
