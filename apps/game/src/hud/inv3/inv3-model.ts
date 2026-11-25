/**
 * Inventory v3 model (HUD v2 spec „Ekwipunek v3”, mockups inventory-v3-list.png / -grid.png):
 * sections of the player panel (W RĘKACH / KIESZENIE / each bag), the container panel, rows with
 * stack grouping, the „Stan” column, client-side sorting, the grid fill and drop previews. Pure
 * functions over the game state; the DOM is in `inventory-v3.ts`.
 */
import { itemViewName } from '../crafting-labels.js';
import type { ContainerId, ContainerView, EquipSlot, ItemView } from '@deadzone/protocol';
import type { TooltipItem } from '@deadzone/ui';
import type { GameState } from '../../state/game-state.js';
import type {
  InventorySort,
  InventorySortSetting,
  InventoryViewMode,
} from '../../settings/schema.js';
import { combineRowVM, type CombineRowVM } from '../combine-model.js';
import type { HudContentIndex, HudItemDef } from '../content-index.js';
import { craftItemName } from '../crafting-labels.js';
import { itemIcon } from '../hud-model.js';
import { itemImage } from '../item-icons.js';
import { formatKg } from '../item-kinds.js';
import { itemTooltip, type CONTEXT_ACTION, type InvCommand } from '../inventory-model.js';
import { containerName } from '../labels.js';

export type InvViewMode = InventoryViewMode;
export type InvSort = InventorySort;
export type InvSide = 'own' | 'box';

/** Dropdown order (spec „Sortowanie”). */
export const SORT_OPTIONS: readonly { id: InvSort; label: string }[] = [
  { id: 'category', label: 'Kategoria' },
  { id: 'name', label: 'Nazwa' },
  { id: 'weight', label: 'Waga' },
  { id: 'condition', label: 'Stan' },
  { id: 'recent', label: 'Ostatnio dodane' },
];
export const sortLabel = (s: InvSort): string =>
  SORT_OPTIONS.find((o) => o.id === s)?.label ?? 'Ilość';

/** Grid: 9 tiles a row in a 600 px panel (56 + 4 gap). */
export const GRID_COLUMNS = 9;

export type InvState =
  | { kind: 'condition'; value: number; max: number }
  | { kind: 'freshness'; value: NonNullable<ItemView['freshness']> }
  | { kind: 'fill'; value: number; max: number }
  | { kind: 'uses'; value: number };

export interface InvRowVM {
  /** Stable key: `i<id>` for one item, `g<def>` for a group. */
  key: string;
  def: string;
  icon: string;
  image?: string;
  name: string;
  count: number;
  weightKg: number;
  state?: InvState;
  hand?: 'P' | 'L';
  /** Worn on the body (clothes, a worn bag; not hands). */
  worn?: boolean;
  /** Group (same def, different state): children rows, collapsed by default. */
  children?: InvRowVM[];
  /** Items behind the row (group: all of them). */
  itemIds: number[];
  tooltip: TooltipItem;
  context?: keyof typeof CONTEXT_ACTION;
  combine?: CombineRowVM;
  /** Sort keys. */
  rank: number;
  recent: number;
}

export type SectionKind = 'hands' | 'main' | 'bag' | 'box';

export interface InvSectionVM {
  /** `hands`, `c<containerId>`. */
  key: string;
  kind: SectionKind;
  /** Drop target container (hands: none, equips instead). */
  containerId?: ContainerId;
  title: string;
  weightKg: number;
  capacityKg: number | null;
  reductionPct?: number;
  rows: InvRowVM[];
  /** Hands: free hand rows (`Lewa ręka · wolna`). */
  freeHands?: ('P' | 'L')[];
}

const KIND_ORDER = [
  'weapon_ranged',
  'weapon_melee',
  'magazine',
  'ammo',
  'ammo_box',
  'tool',
  'medical',
  'food',
  'drink',
  'container',
  'clothing',
  'material',
  'literature',
  'vhs',
  'lure',
  'placeable',
  'misc',
];
const kindRank = (def: HudItemDef | undefined): number => {
  const i = KIND_ORDER.indexOf(def?.kind ?? 'misc');
  return i < 0 ? KIND_ORDER.length : i;
};

/** „Stan” of one item: durability, freshness, fill (drinks), uses, or none. */
export function itemState(it: ItemView, def: HudItemDef | undefined): InvState | undefined {
  // Water vessel (farming): litres inside.
  if (it.waterMaxL !== undefined) return { kind: 'fill', value: it.waterL ?? 0, max: it.waterMaxL };
  if (it.condition !== undefined && def?.durabilityMax)
    return { kind: 'condition', value: it.condition, max: def.durabilityMax };
  if (it.freshness && def?.kind !== 'drink') return { kind: 'freshness', value: it.freshness };
  if (it.uses !== undefined && def?.fillMax)
    return { kind: 'fill', value: it.uses, max: def.fillMax };
  // Gas can: litres inside (vehicle UI, `#4FA8C8` bar).
  if (it.fuelMaxL !== undefined) return { kind: 'fill', value: it.fuelL ?? 0, max: it.fuelMaxL };
  if (it.freshness) return { kind: 'freshness', value: it.freshness };
  if (it.uses !== undefined) return { kind: 'uses', value: it.uses };
  return undefined;
}

/** Colour of a durability fraction (spec: > 50 % green, > 25 % yellow, else red). */
export const conditionColor = (f: number): string =>
  f > 0.5 ? '#7F9A4E' : f > 0.25 ? '#D9B64A' : '#C8453C';

export const FRESHNESS_LOOK: Record<
  NonNullable<ItemView['freshness']>,
  { label: string; color: string }
> = {
  fresh: { label: 'Świeże', color: '#A9C07A' },
  stale: { label: 'Nieświeże', color: '#F0C06A' },
  rotten: { label: 'Zepsute', color: '#E8766C' },
};

/** `12 użyć` (Polish plural). */
export function usesLabel(n: number): string {
  if (n === 1) return '1 użycie';
  const d = n % 10;
  const dd = n % 100;
  return `${n} ${d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'użycia' : 'użyć'}`;
}

/** 0..1 for sorting by state (missing state sorts last). */
const stateFraction = (s: InvState | undefined): number => {
  if (!s) return 2;
  if (s.kind === 'condition' || s.kind === 'fill') return s.max > 0 ? s.value / s.max : 0;
  if (s.kind === 'freshness') return s.value === 'fresh' ? 1 : s.value === 'stale' ? 0.5 : 0;
  return 1;
};
const stateSig = (s: InvState | undefined): string => (s ? `${s.kind}:${s.value}` : '-');

/** Tooltip with the firearm stats of the spec (damage, magazine, shot noise). */
export function tooltipV3(
  it: ItemView,
  def: HudItemDef | undefined,
  /** Magazine feed: capacity of the weapon's magazine item. */
  magCapacity?: number,
): TooltipItem {
  const base = itemTooltip(it, def, contextOf(it, def));
  if (it.fuelMaxL !== undefined || it.vehicle !== undefined) {
    // Gas can / car key (vehicle UI §3).
    const extra =
      it.fuelMaxL !== undefined
        ? [
            {
              label: 'Paliwo',
              value: `${(it.fuelL ?? 0).toFixed(1).replace('.', ',')} / ${it.fuelMaxL}`,
              unit: 'l',
            },
          ]
        : [{ label: 'Pasuje do', value: `auto #${it.vehicle}` }];
    const after =
      it.fuelMaxL !== undefined
        ? [{ label: 'Napełnij', value: 'dystrybutor · 1,5', unit: 'l/s' }]
        : [];
    return { ...base, stats: [...extra, ...base.stats, ...after], actions: TIP_ACTIONS };
  }
  if (it.waterMaxL !== undefined) {
    const l = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
    const water = {
      label: it.waterDirty ? 'Woda (brudna)' : 'Woda',
      value: `${l(it.waterL ?? 0)} / ${l(it.waterMaxL)}`,
      unit: 'l',
    };
    return { ...base, stats: [water, ...base.stats], actions: TIP_ACTIONS };
  }
  if (!def?.ranged) return { ...base, actions: TIP_ACTIONS };
  const r = def.ranged;
  const cap = r.capacity ?? magCapacity;
  const extra = [
    ...(r.damage ? [{ label: 'Obrażenia', value: `${r.damage.min}–${r.damage.max}` }] : []),
    ...(it.uses !== undefined
      ? [
          {
            label: 'Magazynek',
            value: `${it.uses}${cap ? `/${cap}` : ''}`,
            unit: craftItemName(r.ammo),
          },
        ]
      : []),
    ...(r.noiseRadius ? [{ label: 'Hałas strzału', value: String(r.noiseRadius), unit: 'm' }] : []),
  ];
  // „Pozostało” repeats the magazine row for firearms.
  const rest = base.stats.filter((x) => !(it.uses !== undefined && x.label === 'Pozostało'));
  return { ...base, stats: [...extra, ...rest], actions: TIP_ACTIONS };
}
const TIP_ACTIONS = [
  { key: 'LPM', label: 'zaznacz' },
  { key: 'PPM', label: 'menu' },
  { key: '2×LPM', label: 'przenieś' },
];

function contextOf(it: ItemView, def: HudItemDef | undefined): InvRowVM['context'] {
  if (it.equipped?.length) return 'unequip';
  if (def?.equipSlots?.length) return 'equip';
  if (def?.usable) return 'use';
  if (def?.kind === 'vhs') return 'watch';
  return undefined;
}

export function itemRowV3(
  it: ItemView,
  s: GameState,
  content: HudContentIndex,
  hand?: 'P' | 'L',
): InvRowVM {
  const def = content.items.get(it.def);
  const state = itemState(it, def);
  const image = itemImage(it.def);
  const context = contextOf(it, def);
  const combine = combineRowVM(it, s.crafting, content);
  return {
    key: `i${it.id}`,
    def: it.def,
    icon: itemIcon(def),
    ...(image ? { image } : {}),
    name: itemViewName(it),
    count: it.count,
    weightKg: it.weightKg,
    ...(state ? { state } : {}),
    ...(hand ? { hand } : {}),
    ...(it.equipped?.some((e) => e !== 'hand_primary' && e !== 'hand_secondary')
      ? { worn: true }
      : {}),
    itemIds: [it.id],
    tooltip: tooltipV3(
      it,
      def,
      def?.ranged?.magazine
        ? content.items.get(def.ranged.magazine)?.magazine?.capacity
        : undefined,
    ),
    ...(context ? { context } : {}),
    ...(combine ? { combine } : {}),
    rank: kindRank(def),
    recent: it.id,
  };
}

/**
 * Rows of a section: one per item, or (grouping on) items of the same def with different states
 * as one group row with children; same def and same state would already be one sim stack.
 */
export function groupRows(rows: readonly InvRowVM[], group: boolean): InvRowVM[] {
  if (!group) return [...rows];
  const byDef = new Map<string, InvRowVM[]>();
  for (const r of rows) {
    const l = byDef.get(r.def);
    if (l) l.push(r);
    else byDef.set(r.def, [r]);
  }
  const out: InvRowVM[] = [];
  for (const list of byDef.values()) {
    const first = list[0]!;
    if (list.length === 1) {
      out.push(first);
      continue;
    }
    const sigs = new Set(list.map((r) => stateSig(r.state)));
    const rest: InvRowVM = { ...first };
    delete rest.state;
    out.push({
      ...rest,
      key: `g${first.def}`,
      count: list.reduce((n, r) => n + r.count, 0),
      weightKg: list.reduce((n, r) => n + r.weightKg, 0),
      ...(sigs.size === 1 && first.state ? { state: first.state } : {}),
      children: list,
      itemIds: list.flatMap((r) => r.itemIds),
      recent: Math.max(...list.map((r) => r.recent)),
    });
  }
  return out;
}

const collator = new Intl.Collator('pl');

/** Stable client-side sort (does not change the order in the sim). */
export function sortRows(rows: readonly InvRowVM[], sort: InventorySortSetting): InvRowVM[] {
  const dir = sort.desc ? -1 : 1;
  const cmp = (a: InvRowVM, b: InvRowVM): number => {
    switch (sort.by) {
      case 'category':
        return a.rank - b.rank || collator.compare(a.name, b.name);
      case 'name':
        return collator.compare(a.name, b.name);
      // Heaviest / most first by default.
      case 'weight':
        return b.weightKg - a.weightKg;
      case 'count':
        return b.count - a.count;
      case 'condition':
        return stateFraction(a.state) - stateFraction(b.state);
      case 'recent':
        return b.recent - a.recent;
    }
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => dir * cmp(x.r, y.r) || x.i - y.i)
    .map(({ r }) => (r.children ? { ...r, children: sortRows(r.children, sort) } : r));
}

/** Column header click: same column reverses, another column starts ascending. */
export function clickColumn(cur: InventorySortSetting, by: InvSort): InventorySortSetting {
  return cur.by === by ? { by, desc: !cur.desc } : { by, desc: false };
}

const HANDS: readonly [EquipSlot, 'P' | 'L'][] = [
  ['hand_primary', 'P'],
  ['hand_secondary', 'L'],
];

export interface PanelOptions {
  sort: InventorySortSetting;
  group: boolean;
}

/** Player panel sections: W RĘKACH, KIESZENIE (main container), every carried bag. */
export function playerSections(
  s: GameState,
  content: HudContentIndex,
  o: PanelOptions,
): InvSectionVM[] {
  const inv = s.inventory;
  if (!inv) return [];
  const all = Object.values(inv.containers).flatMap((c) => c.items);
  const byId = new Map(all.map((i) => [i.id, i]));
  const handIds = new Set<number>();
  const handRows: InvRowVM[] = [];
  const free: ('P' | 'L')[] = [];
  for (const [slot, tag] of HANDS) {
    const id = inv.equipped[slot];
    const it = id === undefined ? undefined : byId.get(id);
    if (!it) free.push(tag);
    else if (!handIds.has(it.id)) {
      handIds.add(it.id);
      handRows.push(itemRowV3(it, s, content, tag));
    }
  }
  const bagOf = new Map<ContainerId, ItemView>();
  for (const it of all) if (it.container !== undefined) bagOf.set(it.container, it);
  const sections: InvSectionVM[] = [
    {
      key: 'hands',
      kind: 'hands',
      title: 'W rękach',
      weightKg: handRows.reduce((n, r) => n + r.weightKg, 0),
      capacityKg: null,
      rows: handRows,
      freeHands: free,
    },
  ];
  const rowsOf = (c: ContainerView): InvRowVM[] =>
    sortRows(
      groupRows(
        c.items
          // Hand items have their own section; a worn bag is its own section header.
          .filter((i) => !handIds.has(i.id) && !(i.container !== undefined && i.equipped?.length))
          .map((i) => itemRowV3(i, s, content)),
        o.group,
      ),
      o.sort,
    );
  const main = inv.containers[inv.container];
  if (main) {
    sections.push({
      key: `c${main.id}`,
      kind: 'main',
      containerId: main.id,
      title: 'Kieszenie',
      weightKg: main.weightKg,
      capacityKg: main.capacityKg,
      rows: rowsOf(main),
    });
  }
  for (const c of Object.values(inv.containers)) {
    if (c.id === inv.container) continue;
    const bag = bagOf.get(c.id);
    const def = bag ? content.items.get(bag.def) : undefined;
    sections.push({
      key: `c${c.id}`,
      kind: 'bag',
      containerId: c.id,
      title: bag ? craftItemName(bag.def) : 'Torba',
      weightKg: c.weightKg,
      capacityKg: c.capacityKg,
      ...(def?.bagReductionPct ? { reductionPct: def.bagReductionPct } : {}),
      rows: rowsOf(c),
    });
  }
  return sections;
}

/** The opened container as one section (undefined: none open). */
export function containerSection(
  s: GameState,
  content: HudContentIndex,
  o: PanelOptions,
): InvSectionVM | undefined {
  const c = s.container;
  if (!c) return undefined;
  return {
    key: `c${c.id}`,
    kind: 'box',
    containerId: c.id,
    title: containerName(c.type, c.kind),
    weightKg: c.weightKg,
    capacityKg: c.capacityKg,
    rows: sortRows(
      groupRows(
        c.items.map((i) => itemRowV3(i, s, content)),
        o.group,
      ),
      o.sort,
    ),
  };
}

/** Rows as shown (expanded groups followed by their children). */
export function visibleRows(
  rows: readonly InvRowVM[],
  expanded: ReadonlySet<string>,
): { row: InvRowVM; child: boolean }[] {
  return rows.flatMap((row) => [
    { row, child: false },
    ...(row.children && expanded.has(row.key)
      ? row.children.map((c) => ({ row: c, child: true }))
      : []),
  ]);
}

/** Grid tiles to draw: the occupied ones plus empty ones to the end of the row, +1 row. */
export function gridSlots(n: number, cols = GRID_COLUMNS): number {
  return Math.max(cols, Math.ceil(n / cols) * cols + cols);
}

/** Distance label `1,2 m` from the player to a tile centre. */
export function distanceLabel(px: number, py: number, x: number, y: number): string {
  return `${formatKg(Math.hypot(x + 0.5 - px, y + 0.5 - py))} m`;
}

export interface DropPreview {
  /** `UPUŚĆ: PLECAK · +0,8 kg = 8,0 / 12,0` or `BRAK MIEJSCA · …`. */
  label: string;
  fits: boolean;
}

/** What a drop of `addKg` on a section would do (the sim still decides). */
export function dropPreview(sec: InvSectionVM, addKg: number): DropPreview {
  const name = sec.title.toUpperCase();
  if (sec.kind === 'hands') return { label: `DO RĘKI: ${name}`, fits: true };
  const after = sec.weightKg + addKg;
  if (sec.capacityKg === null)
    return { label: `UPUŚĆ: ${name} · +${formatKg(addKg)} kg`, fits: true };
  const fits = after <= sec.capacityKg + 1e-6;
  const tail = `+${formatKg(addKg)} kg = ${formatKg(after)} / ${formatKg(sec.capacityKg)}`;
  return fits
    ? { label: `UPUŚĆ: ${name} · ${tail}`, fits }
    : { label: `BRAK MIEJSCA · ${name} · ${tail}`, fits };
}

/** Weight of `count` pieces of `it` (1 piece without Ctrl, the whole stack with it). */
export const pieceKg = (it: ItemView, whole: boolean): number =>
  whole || it.count <= 1 ? it.weightKg : it.weightKg / it.count;

/**
 * Commands that move items to a section (drag & drop, PRZENIEŚ, double click). `whole` = the
 * whole stack (Ctrl), else one piece (as in PZ). Items already there are skipped.
 */
export function moveCommands(
  s: GameState,
  content: HudContentIndex,
  ids: readonly number[],
  to: InvSectionVM | 'ground',
  whole: boolean,
): InvCommand[] {
  const main = s.inventory?.container;
  const out: InvCommand[] = [];
  for (const id of ids) {
    const it = findAny(s, id);
    if (!it) continue;
    const fromBox = s.container?.items.some((i) => i.id === id) ?? false;
    const count = whole || it.count <= 1 ? undefined : 1;
    const n = count === undefined ? {} : { count };
    if (to === 'ground') {
      if (fromBox || it.equipped?.length) continue;
      out.push({ type: 'drop', item: id, ...n });
      continue;
    }
    if (to.kind === 'hands') {
      const def = content.items.get(it.def);
      if (def?.equipSlots?.includes('hand_primary') && !it.equipped?.includes('hand_primary'))
        out.push({ type: 'equip', item: id, slot: 'hand_primary' });
      continue;
    }
    const target = to.containerId;
    if (target === undefined || containerOf(s, id) === target) continue;
    if (fromBox && target === main) out.push({ type: 'pickUp', item: id, ...n });
    else if (it.equipped?.length && to.kind === 'box') continue;
    else out.push({ type: 'moveItem', item: id, to: target, ...n });
  }
  return out;
}

export function findAny(s: GameState, id: number): ItemView | undefined {
  for (const c of Object.values(s.inventory?.containers ?? {})) {
    const it = c.items.find((i) => i.id === id);
    if (it) return it;
  }
  return s.container?.items.find((i) => i.id === id);
}

function containerOf(s: GameState, id: number): ContainerId | undefined {
  for (const c of Object.values(s.inventory?.containers ?? {}))
    if (c.items.some((i) => i.id === id)) return c.id;
  return s.container?.items.some((i) => i.id === id) ? s.container.id : undefined;
}

export interface SelectionInfo {
  count: number;
  weightKg: number;
}

export function selectionInfo(s: GameState, ids: ReadonlySet<number>): SelectionInfo {
  let weightKg = 0;
  let count = 0;
  for (const id of ids) {
    const it = findAny(s, id);
    if (!it) continue;
    count++;
    weightKg += it.weightKg;
  }
  return { count, weightKg };
}
