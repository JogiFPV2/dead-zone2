import type { Action } from '../../input/actions.js';
import type { ChromeIcon } from './icons.js';

export type QuickAccessId =
  'inventory' | 'character' | 'skills' | 'crafting' | 'map' | 'journal' | 'menu';

export interface QuickAccessDef {
  id: QuickAccessId;
  label: string;
  /** Tooltip suffix after `·`. */
  hint: string;
  icon: ChromeIcon;
  /** Bound action (the key badge shows its current binding). */
  action: Action;
}

/** Top bar shortcuts, left → right (HUD v2 spec §2). */
export const QUICK_ACCESS: readonly QuickAccessDef[] = [
  {
    id: 'inventory',
    label: 'Ekwipunek',
    hint: 'pokaż przedmioty',
    icon: 'bag',
    action: 'inventory',
  },
  {
    id: 'character',
    label: 'Postać',
    hint: 'stan postaci i zdrowie',
    icon: 'heart',
    action: 'character',
  },
  {
    id: 'skills',
    label: 'Umiejętności',
    hint: 'umiejętności i rozwój',
    icon: 'spark',
    action: 'skills',
  },
  {
    id: 'crafting',
    label: 'Crafting',
    hint: 'warsztat i przepisy',
    icon: 'box',
    action: 'crafting',
  },
  { id: 'map', label: 'Mapa', hint: 'pełna mapa okolicy', icon: 'pin', action: 'map' },
  { id: 'journal', label: 'Dziennik', hint: 'cele i notatki', icon: 'book', action: 'journal' },
  { id: 'menu', label: 'Menu', hint: 'pauza i ustawienia', icon: 'cross', action: 'pause' },
];

/** Screens that exist; the others show a „wkrótce” toast. */
export const QUICK_ACCESS_READY: ReadonlySet<QuickAccessId> = new Set([
  'inventory',
  'character',
  'skills',
  'crafting',
  'map',
  'journal',
  'menu',
]);

/** Top bar button to highlight for the open modal (`#app[data-modal]`). */
export function activeQuickAccess(modal: string | undefined): QuickAccessId | undefined {
  if (modal === 'inventory' || modal === 'loot') return 'inventory';
  if (modal === 'workshop') return 'crafting';
  if (modal === 'map') return 'map';
  if (modal === 'character' || modal === 'skills' || modal === 'journal') return modal;
  return undefined;
}

/** Sum of skill levels; a rise means a new level (notification dot on „Umiejętności”). */
export const skillLevelSum = (skills: readonly { level: number }[] | undefined): number =>
  (skills ?? []).reduce((n, s) => n + s.level, 0);
