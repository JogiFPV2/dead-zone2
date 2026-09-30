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
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex, HudItemDef } from './content-index.js';
import { actionKey, moveKeysLabel } from './key-label.js';
import { humanizeId, moodleName } from './labels.js';

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
      return '';
  }
}

/**
 * TEMPORARY hotbar: quick slots 1–5 are not in the sim yet, so the slots show the first five
 * items of the main inventory.
 */
export function hotbarItems(s: GameState, content: HudContentIndex): (SlotItem | null)[] {
  const inv = s.inventory;
  const items = inv ? (inv.containers[inv.container]?.items ?? []) : [];
  const out: (SlotItem | null)[] = [];
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const it = items[i];
    if (!it) {
      out.push(null);
      continue;
    }
    const def = content.items.get(it.def);
    out.push({
      id: String(it.id),
      name: humanizeId(it.def),
      icon: itemIcon(def),
      count: it.count,
      stackable: (def?.maxStack ?? 1) > 1,
      usable: true,
    });
  }
  return out;
}

/** Key hints from the current bindings (spec §3.11 order; only actions the game has). */
export function hintItems(b: Bindings): KeyHint[] {
  return [
    { key: moveKeysLabel(b), label: 'ruch' },
    { key: actionKey(b, 'sprint'), label: 'sprint' },
    { key: actionKey(b, 'crouch'), label: 'skradanie' },
    { key: actionKey(b, 'interact'), label: 'przeszukaj' },
    { key: actionKey(b, 'inventory'), label: 'ekwipunek' },
    { key: actionKey(b, 'map'), label: 'mapa' },
    { key: actionKey(b, 'pause'), label: 'menu' },
    { key: actionKey(b, 'toggleHints'), label: 'skróty' },
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
