import type { ContainerType } from '../../schemas/container-type.js';
import type { LootTable } from '../../schemas/loot-table.js';
import type { Station } from '../../schemas/station.js';
import type { ZombieType } from '../../schemas/zombie-type.js';
import type { AnimalType } from '../../schemas/animal-type.js';
import type { RefList } from './ref-collector.js';

export function collectLootTableRefs(t: LootTable, r: RefList): void {
  t.entries.forEach((e, i) => {
    if ('item' in e) r.add('item', e.item, 'entries', i, 'item');
    else r.add('lootTable', e.table, 'entries', i, 'table');
  });
  r.many('containerType', t.containers, 'containers');
}

export function collectZombieTypeRefs(z: ZombieType, r: RefList): void {
  r.add('lootTable', z.lootTable, 'lootTable');
}

export function collectAnimalTypeRefs(a: AnimalType, r: RefList): void {
  a.loot.forEach((l, i) => r.add('item', l.item, 'loot', i, 'item'));
}

export function collectContainerTypeRefs(c: ContainerType, r: RefList): void {
  r.add('item', c.pickupItem, 'pickupItem');
  r.add('lootTable', c.defaultLootTable, 'defaultLootTable');
  r.many('containerType', c.compartments, 'compartments');
}

export function collectStationRefs(s: Station, r: RefList): void {
  s.levels.forEach((l, i) => {
    r.add('item', l.item, 'levels', i, 'item');
    r.add('recipe', l.recipe, 'levels', i, 'recipe');
  });
}
