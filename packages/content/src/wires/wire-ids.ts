/**
 * Rodzaje słupów i stałe nazwy punktów zaczepienia przewodów.
 * `id` łączy przewód z tym samym punktem na kolejnym słupie (faza, przewód odgromowy, lina nośna).
 */
export const POLE_KINDS = ['hv110', 'hv220', 'hv400', 'lv', 'catenary'] as const;
export type PoleKind = (typeof POLE_KINDS)[number];

/**
 * `L1`–`L3` fazy pierwszego toru, `L4`–`L6` drugiego (słupy dwutorowe),
 * `GW` / `GW2` przewody odgromowe, `N` neutralny nN, `CW` przewód jezdny, `MW` lina nośna.
 */
export const WIRE_IDS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'GW', 'GW2', 'N', 'CW', 'MW'] as const;
export type WireId = (typeof WIRE_IDS)[number];

export interface WireRule {
  /** Muszą być w pliku. */
  readonly required: readonly WireId[];
  /** Mogą być w pliku. */
  readonly optional: readonly WireId[];
  /** Albo wszystkie, albo żaden (np. fazy na słupie nN, drugi tor L4–L6). */
  readonly allOrNone?: readonly WireId[];
  /** Id A dozwolone tylko gdy obecne jest B (np. GW2 tylko z GW). */
  readonly requires?: Readonly<Partial<Record<WireId, WireId>>>;
}

const HV_RULE: WireRule = {
  required: ['L1', 'L2', 'L3'],
  optional: ['L4', 'L5', 'L6', 'GW', 'GW2'],
  allOrNone: ['L4', 'L5', 'L6'],
  requires: { GW2: 'GW' },
};

/** Dozwolone `id` dla rodzaju słupa. */
export const WIRE_RULES: Readonly<Record<PoleKind, WireRule>> = {
  hv110: HV_RULE,
  hv220: HV_RULE,
  hv400: HV_RULE,
  lv: { required: ['N'], optional: ['L1', 'L2', 'L3'], allOrNone: ['L1', 'L2', 'L3'] },
  catenary: { required: ['CW', 'MW'], optional: [] },
};
