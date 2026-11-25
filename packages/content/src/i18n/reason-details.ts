/** Specific `reasonPl` for a generic reason code, e.g. „Wejdź przez okno” with `invalid-state`. */
export const FURNITURE_REASON_DETAILS_PL = {
  'window-closed': 'Okno zamknięte',
  'window-boarded': 'Okno zabite deskami',
} as const satisfies Record<string, string>;
