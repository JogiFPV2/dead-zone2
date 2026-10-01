import type {
  ContainerId,
  ContainerView,
  CraftingView,
  EquipSlot,
  ItemView,
} from '@deadzone/protocol';
import { durabilityRow, type StatRowVM, type TooltipItem } from '@deadzone/ui';
import type { CommandBody } from '../sim/sim-client.js';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex, HudItemDef } from './content-index.js';
import { itemIcon } from './hud-model.js';
import { itemImage } from './item-icons.js';
import { KIND_LABEL, formatKg } from './item-kinds.js';
import { containerName, humanizeId } from './labels.js';
import { combineRowVM, type CombineRowVM } from './combine-model.js';

export { formatKg };

/** Command without the header (the game stamps tick/player). */
export type InvCommand = CommandBody;

const FRESHNESS = { fresh: 'Świeże', stale: 'Nieświeże', rotten: 'Zepsute' } as const;

export interface ItemRowVM {
  id: number;
  name: string;
  sub: string;
  weight: string;
  equipped: boolean;
  /** PPM label: `załóż`, `zdejmij`, `użyj`, `oglądaj` (VHS tape) or none. */
  context?: 'equip' | 'unequip' | 'use' | 'watch';
  /** Vector icon name (`@deadzone/ui`), used when there is no baked `image`. */
  icon: string;
  /** Baked 3D icon URL. */
  image?: string;
  /** Durability 0..1 for the small bar (items with durability). */
  durability?: number;
  tooltip: TooltipItem;
  /** Part of a known combine recipe (tile tint, corner badge, combine tooltip). */
  combine?: CombineRowVM;
}

export const CONTEXT_ACTION = {
  equip: 'załóż',
  unequip: 'zdejmij',
  use: 'użyj',
  watch: 'oglądaj',
} as const;

/** Tooltip (ItemTooltip from @deadzone/ui) for an inventory row. */
export function itemTooltip(
  it: ItemView,
  def: HudItemDef | undefined,
  context: ItemRowVM['context'],
): TooltipItem {
  const stats: StatRowVM[] = [{ label: 'Waga', value: formatKg(it.weightKg), unit: 'kg' }];
  if (it.count > 1) stats.push({ label: 'Ilość', value: String(it.count) });
  if (it.uses !== undefined) stats.push({ label: 'Pozostało', value: String(it.uses) });
  if (it.freshness) {
    stats.push({
      label: 'Świeżość',
      value: FRESHNESS[it.freshness],
      ...(it.freshness === 'rotten' ? { tone: 'danger' as const } : {}),
    });
  }
  if (it.condition !== undefined && def?.durabilityMax) {
    stats.push(durabilityRow(it.condition, def.durabilityMax));
  }
  return {
    name: humanizeId(it.def),
    category: KIND_LABEL[def?.kind ?? ''] ?? 'Przedmiot',
    stats,
    actions: [
      { key: 'LPM', label: 'przenieś' },
      ...(context ? [{ key: 'PPM', label: CONTEXT_ACTION[context] }] : []),
    ],
  };
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

export function itemRow(
  it: ItemView,
  def: HudItemDef | undefined,
  crafting?: CraftingView,
  content?: HudContentIndex,
): ItemRowVM {
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
        : def?.kind === 'vhs'
          ? 'watch'
          : undefined;
  const image = itemImage(it.def);
  const combine = content ? combineRowVM(it, crafting, content) : undefined;
  const durability =
    it.condition !== undefined && def?.durabilityMax
      ? Math.min(1, Math.max(0, it.condition / def.durabilityMax))
      : undefined;
  return {
    id: it.id,
    name: `${humanizeId(it.def)}${it.count > 1 ? ` ×${it.count}` : ''}`,
    sub: sub.join(' · '),
    weight: `${formatKg(it.weightKg)} kg`,
    equipped,
    ...(context ? { context } : {}),
    icon: itemIcon(def),
    ...(image ? { image } : {}),
    ...(durability !== undefined ? { durability } : {}),
    tooltip: itemTooltip(it, def, context),
    ...(combine ? { combine } : {}),
  };
}

/** Equipment slots of the character panel (mockup order: hands, back, torso; head, legs, feet, belt). */
export const EQUIPMENT_SLOTS: readonly { slot: EquipSlot; label: string; also?: EquipSlot }[] = [
  { slot: 'hand_primary', label: 'Prawa ręka' },
  { slot: 'hand_secondary', label: 'Lewa ręka' },
  { slot: 'back', label: 'Plecy' },
  { slot: 'torso_outer', label: 'Tors', also: 'torso_inner' },
  { slot: 'head', label: 'Głowa' },
  { slot: 'legs', label: 'Nogi' },
  { slot: 'feet', label: 'Stopy' },
  { slot: 'belt', label: 'Pas' },
];

export interface EquipSlotVM {
  slot: EquipSlot;
  label: string;
  item?: ItemRowVM;
}

/** Character panel slots with the equipped items (empty slots without `item`). */
export function equipmentVM(s: GameState, content: HudContentIndex): EquipSlotVM[] {
  const eq = s.inventory?.equipped ?? {};
  return EQUIPMENT_SLOTS.map(({ slot, label, also }) => {
    const id = eq[slot] ?? (also ? eq[also] : undefined);
    const it = id === undefined ? undefined : findItem(s, id);
    return {
      slot: it?.equipped?.[0] ?? slot,
      label,
      ...(it ? { item: itemRow(it, content.items.get(it.def), s.crafting, content) } : {}),
    };
  });
}

function panel(
  c: ContainerView,
  title: string,
  content: HudContentIndex,
  crafting: CraftingView | undefined,
  capacityKg: number | null = c.capacityKg,
  weightKg = c.weightKg,
): PanelVM {
  return {
    container: c.id,
    title,
    weightKg,
    capacityKg,
    rows: c.items.map((it) => itemRow(it, content.items.get(it.def), crafting, content)),
  };
}

export function inventoryVM(s: GameState, content: HudContentIndex): InventoryVM {
  const inv = s.inventory;
  const own: PanelVM[] = [];
  if (inv) {
    const main = inv.containers[inv.container];
    if (main) own.push(panel(main, 'Przy sobie', content, s.crafting, inv.capacityKg, inv.loadKg));
    const bagItems = new Map<ContainerId, ItemView>();
    for (const c of Object.values(inv.containers)) {
      for (const it of c.items) if (it.container !== undefined) bagItems.set(it.container, it);
    }
    for (const c of Object.values(inv.containers)) {
      if (c.id === inv.container) continue;
      const bag = bagItems.get(c.id);
      own.push(panel(c, bag ? humanizeId(bag.def) : 'Torba', content, s.crafting));
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
            s.crafting,
          ),
        }
      : {}),
  };
}

export const findItem = (s: GameState, id: number): ItemView | undefined => {
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
  // VHS tape: play it on the TV nearby (sim: `no-station` / `no-power` when there is none).
  if (def?.kind === 'vhs') return { type: 'watchTv', vhs: item };
  return undefined;
}
