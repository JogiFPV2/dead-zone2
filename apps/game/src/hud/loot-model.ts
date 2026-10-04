import type { ContainerId, ContainerView, ItemView } from '@deadzone/protocol';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex } from './content-index.js';
import { itemIcon } from './hud-model.js';
import { itemImage } from './item-icons.js';
import { itemTooltip, type InvCommand } from './inventory-model.js';
import type { TooltipItem } from '@deadzone/ui';
import { containerName } from './labels.js';
import { craftItemName } from './crafting-labels.js';

/**
 * Loot screen model (mockup `deadzone-shots/loot.png`, spec `deadzone-loot-spec.md` §1–2):
 * rows of the player's inventory and the opened container, container tabs, take / put commands
 * and the weight preview. Pure functions over the game state; the DOM is in `loot-window.ts`.
 */

export type Freshness = NonNullable<ItemView['freshness']>;

export interface LootRowVM {
  id: number;
  name: string;
  sub: string;
  /** Freshness dot + tone of the sub line. */
  freshness?: Freshness;
  /** Durability 0..1 (bar before the sub text). */
  durability?: number;
  count: number;
  weightKg: number;
  icon: string;
  image?: string;
  equipped: boolean;
  tooltip: TooltipItem;
}

export interface LootTabVM {
  id: ContainerId;
  label: string;
  kind: ContainerView['kind'];
  type?: string;
  /** Item stacks (known only for the opened container). */
  count?: number;
  active: boolean;
  /**
   * Vehicle container out of reach (dashed tab): why (`tylko z przedniego fotela`). Shown next
   * to its reachable sibling (trunk ↔ glovebox of the same car), vehicle UI [ZAŁ.].
   */
  off?: string;
}

const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: 'Świeże',
  stale: 'Nieświeże',
  rotten: 'Zepsute',
};

export function lootRow(it: ItemView, content: HudContentIndex): LootRowVM {
  const def = content.items.get(it.def);
  const sub: string[] = [];
  if (it.equipped?.length) sub.push('Założone');
  if (it.condition !== undefined && def?.durabilityMax) {
    sub.push(`${Math.round(it.condition)}/${def.durabilityMax}`);
  }
  if (it.uses !== undefined) sub.push(`Pozostało: ${it.uses}`);
  if (it.freshness) sub.push(FRESHNESS_LABEL[it.freshness]);
  const image = itemImage(it.def);
  const durability =
    it.condition !== undefined && def?.durabilityMax
      ? Math.min(1, Math.max(0, it.condition / def.durabilityMax))
      : undefined;
  const equipped = (it.equipped?.length ?? 0) > 0;
  return {
    id: it.id,
    name: craftItemName(it.def),
    sub: sub.join(' · '),
    ...(it.freshness ? { freshness: it.freshness } : {}),
    ...(durability !== undefined ? { durability } : {}),
    count: it.count,
    weightKg: it.weightKg,
    icon: itemIcon(def),
    ...(image ? { image } : {}),
    equipped,
    tooltip: {
      ...itemTooltip(it, def, undefined),
      actions: [
        { key: 'LPM', label: 'weź 1' },
        ...(it.count > 1 ? [{ key: 'Ctrl+LPM', label: `stos ×${it.count}` }] : []),
      ],
    },
  };
}

/** Player side: main inventory then carried bags, flattened (bags themselves stay listed). */
export function ownItems(s: GameState): ItemView[] {
  const inv = s.inventory;
  if (!inv) return [];
  const main = inv.containers[inv.container];
  const out = [...(main?.items ?? [])];
  for (const c of Object.values(inv.containers)) if (c.id !== inv.container) out.push(...c.items);
  return out;
}

/** Title suffix of the player panel: the worn bag (back slot) or „przy sobie”. */
export function ownTitle(s: GameState): string {
  const back = s.inventory?.equipped.back;
  const bag = back === undefined ? undefined : ownItems(s).find((i) => i.id === back);
  return bag ? craftItemName(bag.def) : 'Przy sobie';
}

/** Container tabs: everything in reach plus the opened one; „Podłoga” (ground) always last. */
export function lootTabs(s: GameState): LootTabVM[] {
  const open = s.container;
  const seen = new Set<ContainerId>();
  const tabs: LootTabVM[] = [];
  const add = (id: ContainerId, kind: ContainerView['kind'], type: string | undefined): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const active = open?.id === id;
    tabs.push({
      id,
      kind,
      label: kind === 'ground' ? 'Podłoga' : containerName(type, kind),
      ...(type ? { type } : {}),
      ...(active ? { count: open.items.length } : {}),
      active,
    });
  };
  if (open) add(open.id, open.kind, open.type);
  for (const c of s.nearby) add(c.id, c.kind, c.type);
  for (const v of s.vehicles) {
    const trunk = v.trunk !== undefined && seen.has(v.trunk);
    const glove = v.glovebox !== undefined && seen.has(v.glovebox);
    if (trunk === glove) continue;
    if (!glove && v.glovebox !== undefined)
      tabs.push({
        id: v.glovebox,
        kind: 'vehicle-glovebox',
        label: 'Schowek',
        active: false,
        off: 'tylko z przedniego fotela',
      });
    if (!trunk && v.trunk !== undefined)
      tabs.push({
        id: v.trunk,
        kind: 'vehicle-trunk',
        label: 'Bagażnik',
        active: false,
        off: s.seat ? 'wysiądź i podejdź do tyłu' : v.locked ? 'zamknięte' : 'podejdź do tyłu',
      });
  }
  const rank = (t: LootTabVM): number => (t.kind === 'ground' ? 1 : 0);
  return tabs.sort((a, b) => rank(a) - rank(b));
}

/** Tabs that can be opened (without the dashed vehicle tabs out of reach). */
export const reachableTabs = (s: GameState): LootTabVM[] => lootTabs(s).filter((t) => !t.off);

const inOpen = (s: GameState, id: number): ItemView | undefined =>
  s.container?.items.find((i) => i.id === id);

/** LPM on a container row: one piece; Ctrl+LPM: the whole stack. */
export function takeCommand(s: GameState, id: number, stack: boolean): InvCommand | undefined {
  const it = inOpen(s, id);
  if (!it) return undefined;
  return stack || it.count <= 1
    ? { type: 'pickUp', item: id }
    : { type: 'pickUp', item: id, count: 1 };
}

/** LPM on a player row: put one piece (Ctrl: the stack) into the opened container. */
export function putCommand(s: GameState, id: number, stack: boolean): InvCommand | undefined {
  const to = s.container?.id;
  const it = ownItems(s).find((i) => i.id === id);
  if (to === undefined || !it || it.equipped?.length) return undefined;
  return stack || it.count <= 1
    ? { type: 'moveItem', item: id, to }
    : { type: 'moveItem', item: id, to, count: 1 };
}

export interface TakeAllResult {
  cmds: InvCommand[];
  /** Stacks left behind because of the weight limit. */
  left: number;
}

/**
 * Takes stacks (all of the opened container, or `ids`) in list order while the carried weight
 * stays within `limitKg` (default: the carry capacity, the bar's limit). A stack that doesn't
 * fit is skipped, lighter ones after it are still taken.
 */
export function takeWithinLimit(
  s: GameState,
  ids?: readonly number[],
  limitKg = s.inventory?.capacityKg ?? Infinity,
): TakeAllResult {
  const items = (s.container?.items ?? []).filter((i) => !ids || ids.includes(i.id));
  let load = s.inventory?.loadKg ?? 0;
  const cmds: InvCommand[] = [];
  let left = 0;
  for (const it of items) {
    if (load + it.weightKg > limitKg + 1e-6) {
      left++;
      continue;
    }
    load += it.weightKg;
    cmds.push({ type: 'pickUp', item: it.id });
  }
  return { cmds, left };
}

/** Puts selected player stacks into the opened container (F / „Odłóż”). */
export function putSelected(s: GameState, ids: readonly number[]): InvCommand[] {
  return ids.flatMap((id) => {
    const c = putCommand(s, id, true);
    return c ? [c] : [];
  });
}

export interface SelectionSummary {
  stacks: number;
  pieces: number;
  weightKg: number;
}

export function selectionSummary(
  items: readonly ItemView[],
  ids: ReadonlySet<number>,
): SelectionSummary {
  let stacks = 0;
  let pieces = 0;
  let weightKg = 0;
  for (const it of items) {
    if (!ids.has(it.id)) continue;
    stacks++;
    pieces += it.count;
    weightKg += it.weightKg;
  }
  return { stacks, pieces, weightKg };
}

/** Shift+LPM range: ids between the anchor and `id` in list order (inclusive). */
export function rangeIds(order: readonly number[], anchor: number, id: number): number[] {
  const a = order.indexOf(anchor);
  const b = order.indexOf(id);
  if (a < 0 || b < 0) return [id];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** `HH:MM` and day of the sim clock. */
export function clockLabel(clock: GameState['clock']): { time: string; day: string } {
  if (!clock) return { time: '--:--', day: '' };
  const m = Math.floor(clock.minuteOfDay);
  const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return { time: `${hh}:${mm}`, day: `Dzień ${clock.day}` };
}

/** `1 pojemnik`, `2–4 pojemniki`, `5+ pojemników`. */
export function containersLabel(n: number): string {
  if (n === 1) return '1 pojemnik';
  const d = n % 10;
  const dd = n % 100;
  return `${n} ${d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'pojemniki' : 'pojemników'}`;
}
