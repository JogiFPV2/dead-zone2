import type { ContainerType } from '../../schemas/container-type.js';
import type { LootTable } from '../../schemas/loot-table.js';
import type { ZombieType } from '../../schemas/zombie-type.js';
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

export function collectContainerTypeRefs(c: ContainerType, r: RefList): void {
  r.add('item', c.pickupItem, 'pickupItem');
  r.add('lootTable', c.defaultLootTable, 'defaultLootTable');
}
