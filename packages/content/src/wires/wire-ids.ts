/**
 * Rodzaje słupów i stałe nazwy punktów zaczepienia przewodów.
 * `id` łączy przewód z tym samym punktem na kolejnym słupie (faza, przewód odgromowy, lina nośna).
 */
export const POLE_KINDS = ['hv110', 'hv400', 'lv', 'catenary'] as const;
export type PoleKind = (typeof POLE_KINDS)[number];

/** `L1`–`L3` fazy, `GW` przewód odgromowy, `N` neutralny nN, `CW` przewód jezdny, `MW` lina nośna. */
export const WIRE_IDS = ['L1', 'L2', 'L3', 'GW', 'N', 'CW', 'MW'] as const;
export type WireId = (typeof WIRE_IDS)[number];

export interface WireRule {
  /** Muszą być w pliku. */
  readonly required: readonly WireId[];
  /** Mogą być w pliku. */
  readonly optional: readonly WireId[];
  /** Albo wszystkie, albo żaden (np. fazy na słupie nN). */
  readonly allOrNone?: readonly WireId[];
}

/** Dozwolone `id` dla rodzaju słupa. */
export const WIRE_RULES: Readonly<Record<PoleKind, WireRule>> = {
  hv110: { required: ['L1', 'L2', 'L3'], optional: ['GW'] },
  hv400: { required: ['L1', 'L2', 'L3'], optional: ['GW'] },
  lv: { required: ['N'], optional: ['L1', 'L2', 'L3'], allOrNone: ['L1', 'L2', 'L3'] },
  catenary: { required: ['CW', 'MW'], optional: [] },
};
