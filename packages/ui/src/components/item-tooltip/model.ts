/** ItemTooltip (approved redesign, mockup `tooltip-item.png`). */
import { tokens } from '../../tokens/tokens.generated.js';
import { ms, px } from '../../tokens/units.js';
import type { StatRowVM } from '../stat-row/model.js';

export interface ItemAction {
  key: string;
  label: string;
}

/** What the tooltip reads from an item. */
export interface TooltipItem {
  name: string;
  /** `Broń · Krótka ostra` (uppercased by CSS). */
  category: string;
  /** One row per stat (see `StatRowVM`, `durabilityRow`). */
  stats: readonly StatRowVM[];
  /** Footer key chips; default `DEFAULT_ITEM_ACTIONS`. Empty list hides the footer. */
  actions?: readonly ItemAction[];
}

/** Mockup footer: `LPM atak · PPM celuj · Q upuść` (keys from the current binding). */
export const DEFAULT_ITEM_ACTIONS: readonly ItemAction[] = [
  { key: 'LPM', label: 'atak' },
  { key: 'PPM', label: 'celuj' },
  { key: 'Q', label: 'upuść' },
];

/** After a selection change the tooltip stays for motion.tooltip.hold (2.5 s). */
export const TOOLTIP_HOLD_MS = ms(tokens.motion.tooltip.hold);
/** Hover shows it after motion.tooltip.delay (250 ms) and keeps it while hovered. */
export const TOOLTIP_DELAY_MS = ms(tokens.motion.tooltip.delay);
/** size.tooltip.width (300 px). */
export const TOOLTIP_WIDTH = px(tokens.size.tooltip.width);

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Tooltip position in the HUD's coordinates (spec §2): left edge = hotbar left + slot offset,
 * bottom = hotbar top − 10 (space.2-5), clamped to the safe margin (size.safe) of the viewport.
 */
export function tooltipPosition(
  hotbar: Rect,
  slotOffsetX: number,
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const safe = px(tokens.size.safe);
  const gap = px(tokens.space['2-5']);
  const clamp = (v: number, min: number, max: number) =>
    Math.min(Math.max(v, min), Math.max(min, max));
  return {
    left: clamp(hotbar.left + slotOffsetX, safe, viewport.width - safe - tooltip.width),
    top: clamp(hotbar.top - gap - tooltip.height, safe, viewport.height - safe - tooltip.height),
  };
}
