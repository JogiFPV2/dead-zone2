import type { NearbyContainerView } from '@deadzone/protocol';
import {
  toPolarity,
  type ActionVM,
  type KeyHint,
  type MoodleLevel,
  type MoodleVM,
  type SlotItem,
  type StatsVM,
  type ThreatLevel,
} from '@deadzone/ui';
import type { Bindings } from '../input/bindings.js';
import type { CommandBody } from '../sim/sim-client.js';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex, HudItemDef } from './content-index.js';
import { itemImage } from './item-icons.js';
import { actionKey, moveKeysLabel } from './key-label.js';
import { moodleName } from './labels.js';
import { craftItemName } from './crafting-labels.js';

/** Pure view-model builders: GameState (sim mirror) → `@deadzone/ui` props. */

export const HOTBAR_SLOTS = 5;

const round = (v: number): number => Math.round(Math.min(100, Math.max(0, v)));

/**
 * Sim needs grow with time (hunger 0 = fed, 100 = starving); the HUD bars show what is left
 * (spec: full bar = good), so thirst/hunger/energy are inverted. Energy = 100 − fatigue.
 */
export function statsVM(s: GameState): StatsVM {
  const st = s.player.stats;
  return {
    health: round(st.health ?? 100),
    thirst: round(100 - (st.thirst ?? 0)),
    hunger: round(100 - (st.hunger ?? 0)),
    energy: round(100 - (st.fatigue ?? 0)),
  };
}

/**
 * Moodle chips. `since` remembers when each moodle appeared (order tie-breaker, spec §3.2) and
 * drops entries that are gone; the list component sorts and folds the overflow.
 */
export function moodleVMs(
  moodles: Readonly<Record<string, number>>,
  content: HudContentIndex,
  since: Map<string, number>,
  now: number,
): MoodleVM[] {
  for (const id of since.keys()) if (!(id in moodles)) since.delete(id);
  const out: MoodleVM[] = [];
  for (const [id, level] of Object.entries(moodles)) {
    if (level <= 0) continue;
    if (!since.has(id)) since.set(id, now);
    out.push({
      id,
      label: moodleName(id),
      polarity: toPolarity(content.moodles.get(id)?.polarity ?? 'negative'),
      level: Math.min(4, Math.max(0, Math.round(level))) as MoodleLevel,
      since: since.get(id) ?? now,
    });
  }
  return out;
}

/** Closest container in reach to the player (tile centre distance); undefined if none. */
export function nearestContainer(
  nearby: readonly NearbyContainerView[],
  px: number,
  py: number,
): NearbyContainerView | undefined {
  let best: NearbyContainerView | undefined;
  let bestD = Infinity;
  for (const c of nearby) {
    const d = Math.hypot(c.x + 0.5 - px, c.y + 0.5 - py);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export type InteractIntent =
  { type: 'open'; container: number } | { type: 'close' } | { type: 'cancel' } | { type: 'none' };

/**
 * What the interact key does now: close the open container, cancel a running search, else
 * search/open the nearest container.
 */
export function interactIntent(s: GameState, px: number, py: number): InteractIntent {
  if (s.container) return { type: 'close' };
  if (s.action) return s.action.kind === 'search' ? { type: 'cancel' } : { type: 'none' };
  const c = nearestContainer(s.nearby, px, py);
  return c ? { type: 'open', container: c.id } : { type: 'none' };
}

/** Progress 0..1 of the current timed action at `tick` (may be fractional). */
export function actionProgress(s: GameState, tick: number): number | undefined {
  const a = s.action;
  if (!a) return undefined;
  const span = Math.max(1, a.endTick - a.startTick);
  return Math.min(1, Math.max(0, (tick - a.startTick) / span));
}

/** Contextual buttons (spec §3.10): shown only when there is something to do in reach. */
export function actionVMs(
  s: GameState,
  px: number,
  py: number,
  key: string,
  tick: number,
): ActionVM[] {
  if (s.container) {
    return [
      { id: 'interact', label: 'Zamknij', icon: 'check', key, variant: 'secondary', enabled: true },
    ];
  }
  if (s.action?.kind === 'search') {
    return [
      {
        id: 'interact',
        label: 'Przeszukiwanie',
        icon: 'target',
        key,
        variant: 'primary',
        // Stays active: the key/button cancels the search.
        enabled: true,
        progress: Math.round((actionProgress(s, tick) ?? 0) * 50) / 50,
      },
    ];
  }
  const c = nearestContainer(s.nearby, px, py);
  if (!c) return [];
  return [
    {
      id: 'interact',
      label: c.searched ? 'Otwórz' : 'Przeszukaj',
      icon: 'target',
      key,
      variant: 'primary',
      enabled: s.action === undefined,
    },
  ];
}

/** Slot icon from the item kind (only icons the UI package has; others show none). */
export function itemIcon(def: HudItemDef | undefined): string {
  if (!def) return '';
  switch (def.kind) {
    case 'weapon_melee':
      return def.meleeCategory?.startsWith('blade') ? 'knife' : 'crowbar';
    case 'food':
      return 'can';
    case 'drink':
      return 'bottle';
    default:
      if (def.id.endsWith(':duct-tape')) return 'tape';
      if (def.id.endsWith(':nails')) return 'nails';
      return '';
  }
}

/** Hotbar slot 1 (index 0) = left hand, 2 = right hand, 3–5 = pinned quick slots. */
export const HAND_OF_SLOT = ['hand_secondary', 'hand_primary'] as const;
export type HandSlotName = (typeof HAND_OF_SLOT)[number];

/** Hand that attacks (`setActiveHand`): left = slot 1, right = slot 2 (the default). */
export function activeHand(s: GameState): HandSlotName {
  return s.inventory?.activeHand ?? 'hand_primary';
}

/** Carried item by id (main inventory and bags). */
function carried(s: GameState, id: number | null | undefined) {
  if (id === null || id === undefined) return undefined;
  for (const c of Object.values(s.inventory?.containers ?? {})) {
    const it = c.items.find((i) => i.id === id);
    if (it) return it;
  }
  return undefined;
}

/** Item ids behind the hotbar: left hand, right hand, then the pinned quick slots 3–5. */
export function hotbarIds(s: GameState): (number | undefined)[] {
  const eq = s.inventory?.equipped ?? {};
  const out: (number | undefined)[] = [eq.hand_secondary, eq.hand_primary];
  for (let i = 0; i < HOTBAR_SLOTS - 2; i++) {
    const id = s.inventory?.quickSlots?.[i] ?? undefined;
    out.push(carried(s, id) ? id! : undefined);
  }
  return out;
}

/** Hotbar slots: hands first (a two-handed item shows in both), then the pinned items. */
export function hotbarItems(s: GameState, content: HudContentIndex): (SlotItem | null)[] {
  return hotbarIds(s).map((id) => {
    const it = carried(s, id);
    if (!it) return null;
    const def = content.items.get(it.def);
    const image = itemImage(it.def);
    return {
      id: String(it.id),
      name: craftItemName(it.def),
      icon: itemIcon(def),
      ...(image ? { image } : {}),
      count: it.count,
      stackable: (def?.maxStack ?? 1) > 1,
      usable: true,
    };
  });
}

/**
 * Hotbar slot pressed (key 1–5 or click): 1 / 2 pick the hand that attacks; 3–5 put the pinned
 * item into the active hand, or away again when it is already there.
 */
export function hotbarCommand(
  s: GameState,
  content: HudContentIndex,
  index: number,
): CommandBody | undefined {
  if (s.player.sleeping) return undefined;
  const hand = HAND_OF_SLOT[index as 0 | 1];
  if (hand) return hand === activeHand(s) ? undefined : { type: 'setActiveHand', hand };
  const id = hotbarIds(s)[index];
  const it = carried(s, id);
  if (!it) return undefined;
  const active = activeHand(s);
  if (s.inventory?.equipped[active] === it.id) return { type: 'unequip', slot: active };
  // Any item can be held (the sim's `allowedSlots`).
  return { type: 'equip', item: it.id, slot: active };
}

/** Highlighted hotbar slot: the active hand (0 = left, 1 = right). */
export function hotbarHeldIndex(s: GameState): number {
  return activeHand(s) === 'hand_secondary' ? 0 : 1;
}

/**
 * Item dropped on hotbar slot `index` (drag from the inventory): 1 / 2 put it into that hand,
 * 3–5 pin it there (it stays where it is).
 */
export function hotbarDropCommand(
  s: GameState,
  index: number,
  item: number,
): CommandBody | undefined {
  const hand = HAND_OF_SLOT[index as 0 | 1];
  if (hand) {
    if (s.inventory?.equipped[hand] === item) return undefined;
    const it = carried(s, item) ?? s.container?.items.find((i) => i.id === item);
    return it ? { type: 'equip', item, slot: hand } : undefined;
  }
  if (index < 2 || index >= HOTBAR_SLOTS || !carried(s, item)) return undefined;
  return { type: 'setQuickSlot', index: index - 2, item };
}

/** Clear hotbar slot `index` (PPM on it): a hand puts its item away, 3–5 unpin. */
export function hotbarClearCommand(s: GameState, index: number): CommandBody | undefined {
  const hand = HAND_OF_SLOT[index as 0 | 1];
  if (hand)
    return s.inventory?.equipped[hand] !== undefined ? { type: 'unequip', slot: hand } : undefined;
  if (index < 2 || index >= HOTBAR_SLOTS || hotbarIds(s)[index] === undefined) return undefined;
  return { type: 'setQuickSlot', index: index - 2 };
}

/** First free pinned quick slot (index 2..4), or undefined when all are taken. */
export function freeQuickSlot(s: GameState): number | undefined {
  const ids = hotbarIds(s);
  for (let i = 2; i < HOTBAR_SLOTS; i++) if (ids[i] === undefined) return i;
  return undefined;
}

/** Key hints from the current bindings (spec §3.11 order; only actions the game has). */
export function hintItems(b: Bindings, firearm = false): KeyHint[] {
  // Firearm in hand (spec firearm HUD §5): aim / shoot / reload / magazines.
  if (firearm)
    return [
      { key: moveKeysLabel(b), label: 'ruch' },
      { key: actionKey(b, 'secondaryAction'), label: 'celuj' },
      { key: actionKey(b, 'primaryAction'), label: 'strzał' },
      { key: actionKey(b, 'reload'), label: 'przeładuj' },
      { key: actionKey(b, 'inventory'), label: 'magazynki' },
      { key: actionKey(b, 'pause'), label: 'menu' },
      { key: actionKey(b, 'toggleHints'), label: 'skróty' },
    ];
  // HUD v2 (spec §3): short row; the top bar lists the screens with their keys.
  return [
    { key: moveKeysLabel(b), label: 'ruch' },
    { key: actionKey(b, 'sprint'), label: 'sprint' },
    { key: actionKey(b, 'crouch'), label: 'skradanie' },
    { key: actionKey(b, 'inventory'), label: 'ekwipunek' },
    { key: actionKey(b, 'map'), label: 'mapa' },
  ];
}

/** Change detection for small view models: update the DOM only when this string changes. */
export const vmKey = (v: unknown): string => JSON.stringify(v);

/** Sim threat 0–100 → banner level: <25 none, <50 medium, <75 high, else critical. */
export function threatLevel(threat: number): ThreatLevel {
  if (threat < 25) return 'low';
  if (threat < 50) return 'medium';
  if (threat < 75) return 'high';
  return 'critical';
}
