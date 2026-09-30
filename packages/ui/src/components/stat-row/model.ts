/**
 * Stat row (approved ItemTooltip redesign; shared with the item-combine tooltip): label left
 * (muted), value right (accent.hi, semi-bold, tabular-nums) with an optional smaller muted
 * unit, optional small bar (durability). Thin divider between rows.
 */

/** `danger` for negative effects (e.g. combine: `Krwawienie +25%`). */
export type StatTone = 'default' | 'danger';

export interface StatRowVM {
  label: string;
  /** Formatted value: `0,8`, `0,6–1,2`, `8/10`. */
  value: string;
  /** Unit after the value, smaller and muted: `m`, `/s`, `kg`. */
  unit?: string;
  tone?: StatTone;
  /** 0..1: draws the small bar before the value (durability). */
  bar?: number;
}

/** Decimal with a comma, as in the approved mockup: `formatDecimal(0.8)` → `0,8`. */
export function formatDecimal(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', ',');
}

/** Range with an en dash: `formatRange(0.6, 1.2)` → `0,6–1,2`. */
export const formatRange = (min: number, max: number, digits = 1): string =>
  `${formatDecimal(min, digits)}–${formatDecimal(max, digits)}`;

/** Durability row: `8/10` with a bar at 80%. */
export function durabilityRow(current: number, max: number, label = 'Trwałość'): StatRowVM {
  const bar = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;
  return { label, value: `${Math.round(current)}/${Math.round(max)}`, bar };
}

export const clampBar = (v: number): number =>
  Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
