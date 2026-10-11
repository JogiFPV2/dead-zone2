/** Minimum tabeli łupów potrzebne do wyboru (pasuje `LootTable` i definicje z Symulacji). */
export interface LootTableLike {
  readonly id: string;
  readonly rooms: readonly string[];
  readonly containers: readonly string[];
}

/** Minimum typu schowka potrzebne do wyboru (pasuje `ContainerType`). */
export interface ContainerTypeLike {
  readonly id: string;
  readonly defaultLootTable?: string | undefined;
}

/**
 * Tabela łupów schowka (pojemnik ważniejszy niż pomieszczenie; `tables` posortowane po id):
 * 1. tabela pomieszczenia, która wprost wymienia ten typ w `containers` (pomieszczenie
 *    podmienia loot, np. lodówka w sklepie → `base:shop-fridge`),
 * 2. własna tabela schowka `defaultLootTable` (lodówka → jedzenie i napoje),
 * 3. ogólna tabela pomieszczenia (`containers` puste) — tylko dla schowków bez własnej tabeli.
 */
export function lootTableForContainer<T extends LootTableLike>(
  tables: readonly T[],
  byId: (id: string) => T | undefined,
  type: ContainerTypeLike,
  roomType: string | undefined,
): T | undefined {
  if (roomType) {
    const room = tables.find((t) => t.rooms.includes(roomType) && t.containers.includes(type.id));
    if (room) return room;
  }
  const own = type.defaultLootTable ? byId(type.defaultLootTable) : undefined;
  if (own) return own;
  if (!roomType) return undefined;
  return tables.find((t) => t.rooms.includes(roomType) && t.containers.length === 0);
}
