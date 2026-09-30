import type { ContainerId, ContainerView, ItemView } from '@deadzone/protocol';
import type { CommandBody } from '../sim/sim-client.js';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex, HudItemDef } from './content-index.js';
import { containerName, humanizeId } from './labels.js';

/** Command without the header (the game stamps tick/player). */
export type InvCommand = CommandBody;

/** `8.44` → `8,4`. */
export const formatKg = (kg: number): string => kg.toFixed(1).replace('.', ',');

const FRESHNESS = { fresh: 'Świeże', stale: 'Nieświeże', rotten: 'Zepsute' } as const;

export interface ItemRowVM {
  id: number;
  name: string;
  sub: string;
  weight: string;
  equipped: boolean;
  /** PPM label: `załóż`, `zdejmij`, `użyj` or none. */
  context?: 'equip' | 'unequip' | 'use';
}

export interface PanelVM {
  /** Target of `moveItem` when an item is dropped on this panel. */
  container: ContainerId;
  title: string;
  weightKg: number;
  capacityKg: number | null;
  rows: ItemRowVM[];
}

export interface InventoryVM {
  /** Main inventory, then carried bags. */
  own: PanelVM[];
  /** Opened container; undefined = none open. */
  open?: PanelVM;
}

export function itemRow(it: ItemView, def: HudItemDef | undefined): ItemRowVM {
  const sub: string[] = [];
  if (it.equipped?.length) sub.push('Założone');
  if (it.condition !== undefined && def?.durabilityMax) {
    sub.push(`Trwałość ${Math.round(it.condition)}/${def.durabilityMax}`);
  }
  if (it.uses !== undefined) sub.push(`Pozostało: ${it.uses}`);
  if (it.freshness) sub.push(FRESHNESS[it.freshness]);
  const equipped = (it.equipped?.length ?? 0) > 0;
  const context = equipped
    ? 'unequip'
    : def?.equipSlots?.length
      ? 'equip'
      : def?.usable
        ? 'use'
        : undefined;
  return {
    id: it.id,
    name: `${humanizeId(it.def)}${it.count > 1 ? ` ×${it.count}` : ''}`,
    sub: sub.join(' · '),
    weight: `${formatKg(it.weightKg)} kg`,
    equipped,
    ...(context ? { context } : {}),
  };
}

function panel(
  c: ContainerView,
  title: string,
  content: HudContentIndex,
  capacityKg: number | null = c.capacityKg,
  weightKg = c.weightKg,
): PanelVM {
  return {
    container: c.id,
    title,
    weightKg,
    capacityKg,
    rows: c.items.map((it) => itemRow(it, content.items.get(it.def))),
  };
}

export function inventoryVM(s: GameState, content: HudContentIndex): InventoryVM {
  const inv = s.inventory;
  const own: PanelVM[] = [];
  if (inv) {
    const main = inv.containers[inv.container];
    if (main) own.push(panel(main, 'Przy sobie', content, inv.capacityKg, inv.loadKg));
    const bagItems = new Map<ContainerId, ItemView>();
    for (const c of Object.values(inv.containers)) {
      for (const it of c.items) if (it.container !== undefined) bagItems.set(it.container, it);
    }
    for (const c of Object.values(inv.containers)) {
      if (c.id === inv.container) continue;
      const bag = bagItems.get(c.id);
      own.push(panel(c, bag ? humanizeId(bag.def) : 'Torba', content));
    }
  }
  const open = s.container;
  return {
    own,
    ...(open
      ? {
          open: panel(
            open,
            `${containerName(open.type, open.kind)}${open.kind === 'ground' ? '' : ' · schowek'}`,
            content,
          ),
        }
      : {}),
  };
}

const findItem = (s: GameState, id: number): ItemView | undefined => {
  for (const c of Object.values(s.inventory?.containers ?? {})) {
    const it = c.items.find((i) => i.id === id);
    if (it) return it;
  }
  return s.container?.items.find((i) => i.id === id);
};

/** Click / Shift+click: container → main inventory; own → open container (or the ground). */
export function quickTransfer(s: GameState, item: number): InvCommand | undefined {
  if (s.container?.items.some((i) => i.id === item)) return { type: 'pickUp', item };
  const it = findItem(s, item);
  if (!it || it.equipped?.length) return undefined;
  return s.container ? { type: 'moveItem', item, to: s.container.id } : { type: 'drop', item };
}

/** Drag & drop onto a panel. */
export function moveTo(s: GameState, item: number, to: ContainerId): InvCommand | undefined {
  const main = s.inventory?.container;
  if (s.container?.items.some((i) => i.id === item) && to === main) return { type: 'pickUp', item };
  const it = findItem(s, item);
  if (!it) return undefined;
  const inTarget =
    s.container?.id === to
      ? s.container.items.some((i) => i.id === item)
      : (s.inventory?.containers[to]?.items.some((i) => i.id === item) ?? false);
  if (inTarget) return undefined;
  return { type: 'moveItem', item, to };
}

/** `WEŹ WSZYSTKO`: every item of the open container into the main inventory. */
export function takeAll(s: GameState): InvCommand[] {
  return (s.container?.items ?? []).map((i) => ({ type: 'pickUp', item: i.id }) as const);
}

/** `ODŁÓŻ WSZYSTKO`: every unequipped item of the main inventory into the open container. */
export function putAll(s: GameState): InvCommand[] {
  const inv = s.inventory;
  const to = s.container?.id;
  if (!inv || to === undefined) return [];
  return (inv.containers[inv.container]?.items ?? [])
    .filter((i) => !i.equipped?.length && i.container === undefined)
    .map((i) => ({ type: 'moveItem', item: i.id, to }) as const);
}

/** PPM: equip into the first slot, unequip, or use. */
export function contextCommand(
  s: GameState,
  content: HudContentIndex,
  item: number,
): InvCommand | undefined {
  const it = findItem(s, item);
  if (!it) return undefined;
  const slot = it.equipped?.[0];
  if (slot) return { type: 'unequip', slot };
  const def = content.items.get(it.def);
  const first = def?.equipSlots?.[0];
  if (first) return { type: 'equip', item, slot: first };
  if (def?.usable) return { type: 'useItem', item };
  return undefined;
}
