import type { CombatView, ItemView } from '@deadzone/protocol';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex } from './content-index.js';
import { humanizeId } from './labels.js';

/**
 * Firearm HUD (spec deadzone-firearm-hud-spec.md, mockups hud-firearm*.png): the ammo widget by
 * the hotbar, its hint tag and the aim reticle. Pure functions of the sim view + content.
 */

export type FirearmState = 'normal' | 'low' | 'empty' | 'reloading' | 'shell' | 'jammed';
/** Round indicator: bars (≥ 9 rounds, up to 30), shells (< 9), a continuous bar (> 30). */
export type PipStyle = 'bars' | 'shells' | 'pill' | 'none';

export interface HintVM {
  variant: 'primary' | 'glass';
  /** Key badge text; absent = no key (BRAK AMUNICJI). */
  key?: string;
  label: string;
  disabled?: boolean;
}

export interface FirearmVM {
  weapon: string;
  name: string;
  state: FirearmState;
  /** Title row label for reloading states (PRZEŁADOWANIE, ŁADOWANIE NABOI, …). */
  title: string;
  loaded: number;
  capacity: number;
  /** Loose rounds of the weapon's ammo carried (ZAPAS). */
  reserve: number;
  /** Magazine feed: carried magazines of the right type with rounds. */
  reserveMags: number;
  ammo: string;
  pips: PipStyle;
  /** Reload progress 0..1 (reloading / shell); per round for single-round loading. */
  progress?: number;
  /** Seconds left of the current reload step. */
  secLeft?: number;
  hint?: HintVM;
  noiseRadius: number;
  rangeTiles: number;
}

const NAMES: Record<string, string> = {
  'base:pistol': 'Pistolet M9',
  'base:compact-pistol': 'Pistolet kompakt.',
  'base:heavy-pistol': 'Pistolet .45',
  'base:revolver': 'Rewolwer .38',
  'base:magnum-revolver': 'Magnum .44',
  'base:pump-shotgun': 'Strzelba pompka',
  'base:double-barrel-shotgun': 'Dwururka',
  'base:hunting-rifle': 'Karabin myśliwski',
  'base:assault-rifle': 'Karabin szturmowy',
};
export const firearmName = (id: string): string => NAMES[id] ?? humanizeId(id);

/** „Mało”: loaded ≤ ceil(capacity × 0.25) and > 0 (15 → 4, 6 → 2, 2 → 1). */
export const lowThreshold = (capacity: number): number => Math.ceil(capacity * 0.25);

export function pipStyle(capacity: number): PipStyle {
  if (capacity <= 0) return 'none';
  if (capacity > 30) return 'pill';
  return capacity < 9 ? 'shells' : 'bars';
}

function carried(s: GameState): ItemView[] {
  const inv = s.inventory;
  if (!inv) return [];
  return Object.values(inv.containers).flatMap((c) => c.items);
}

/** Reload progress 0..1 at `tick` from the view's step ticks (falls back to `reloadProgress`). */
export function reloadProgressAt(c: CombatView, tick: number): number | undefined {
  if (c.reloadUntil === undefined || c.reloadKind === undefined) return undefined;
  if (c.reloadStartTick !== undefined && c.reloadUntil > c.reloadStartTick) {
    const p = (tick - c.reloadStartTick) / (c.reloadUntil - c.reloadStartTick);
    return Math.min(1, Math.max(0, p));
  }
  return c.reloadProgress;
}

export interface FirearmKeys {
  reload: string;
  attack: string;
  inventory: string;
}

/** Widget view model, or undefined when no firearm is in `hand_primary`. */
export function firearmVM(
  s: GameState,
  content: HudContentIndex,
  tick: number,
  tickMs: number,
  keys: FirearmKeys,
): FirearmVM | undefined {
  const c = s.combat;
  const weapon = c?.weapon;
  if (!c || !weapon) return undefined;
  const def = content.items.get(weapon)?.ranged;
  if (!def) return undefined;
  const items = carried(s);
  const reserve = items.filter((i) => i.def === def.ammo).reduce((n, i) => n + i.count, 0);
  const mags = def.magazine ? items.filter((i) => i.def === def.magazine) : [];
  const reserveMags = mags.filter((i) => (i.uses ?? 0) > 0).length;
  const loaded = c.ammo ?? 0;
  const capacity =
    c.capacity ??
    (def.feed === 'internal'
      ? (def.capacity ?? 0)
      : (content.items.get(def.magazine ?? '')?.magazine?.capacity ?? 0));
  const progress = reloadProgressAt(c, tick);
  const reloading = progress !== undefined && c.reloadKind !== undefined;
  const secLeft =
    reloading && c.reloadUntil !== undefined
      ? Math.max(0, ((c.reloadUntil - tick) * tickMs) / 1000)
      : undefined;
  const canReload = def.feed === 'internal' ? reserve > 0 : reserveMags > 0;

  let state: FirearmState;
  let title = firearmName(weapon);
  if (reloading && c.reloadKind === 'single') {
    state = 'shell';
    title = 'Ładowanie naboi';
  } else if (reloading) {
    state = 'reloading';
    title =
      c.reloadKind === 'unjam'
        ? 'Usuwanie zacięcia'
        : c.reloadKind === 'loadMagazine'
          ? 'Ładowanie magazynka'
          : 'Przeładowanie';
  } else if (c.jammed) state = 'jammed';
  else if (loaded <= 0) state = 'empty';
  else if (loaded <= lowThreshold(capacity)) state = 'low';
  else state = 'normal';

  let hint: HintVM | undefined;
  if (state === 'shell') hint = { variant: 'glass', key: keys.attack, label: 'Przerwij ładowanie' };
  else if (state === 'jammed')
    hint = {
      variant: 'primary',
      key: keys.reload,
      label: `Usuń zacięcie · ${def.reloadSec.toFixed(1)} s`,
    };
  else if (state === 'empty') {
    if (canReload) hint = { variant: 'primary', key: keys.reload, label: 'Przeładuj' };
    else if (def.feed === 'magazine' && reserve > 0)
      hint = { variant: 'glass', key: keys.inventory, label: 'Załaduj magazynek' };
    else hint = { variant: 'glass', label: 'Brak amunicji', disabled: true };
  } else if (state === 'low' && canReload)
    hint = { variant: 'glass', key: keys.reload, label: 'Przeładuj' };

  return {
    weapon,
    name: firearmName(weapon),
    state,
    title,
    loaded,
    capacity,
    reserve,
    reserveMags,
    ammo: def.ammo,
    pips: pipStyle(capacity),
    ...(reloading ? { progress } : {}),
    ...(secLeft !== undefined ? { secLeft } : {}),
    ...(hint ? { hint } : {}),
    noiseRadius: def.noiseRadius,
    rangeTiles: def.rangeTiles,
  };
}

/** Hotbar dock side: slots 1–3 → left of the hotbar, 4–5 → right. */
export const dockSide = (selectedSlot: number): 'left' | 'right' =>
  selectedSlot >= 3 ? 'right' : 'left';

/** Reticle radius (px): tan(spread) × distance (m) × px/m, clamped 8–48. */
export function reticleRadius(spread: number, distanceM: number, pxPerM: number): number {
  const r = Math.tan(Math.max(0, spread)) * Math.max(0, distanceM) * pxPerM;
  return Math.min(48, Math.max(8, r));
}

/** Spread ≥ 0.10 rad → warning colour. */
export const SPREAD_WARN = 0.1;

/** Minimap noise ring radius (px): noiseRadius × px/m, at most the edge (94). */
export const noiseRingRadius = (noiseRadius: number, pxPerM = 2.5, max = 94): number =>
  Math.min(max, Math.max(0, noiseRadius * pxPerM));
