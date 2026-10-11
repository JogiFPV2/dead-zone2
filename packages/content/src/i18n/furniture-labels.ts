/**
 * Polish texts of the furniture / edge context menu (`SimViewPatch.furnitureActions`): action
 * labels by action id, default reason texts by reason code and object type names. The sim fills
 * `labelPl` / `reasonPl` from here (Designer spec "Realizm…", reason table). Action ids with a
 * `prefix:` (e.g. `lockpick:<itemId>`) take the label of the prefix.
 */
export const FURNITURE_ACTIONS_PL = {
  open: 'Otwórz',
  close: 'Zamknij',
  lock: 'Zamknij na zamek',
  unlock: 'Otwórz zamek',
  'unlock-key': 'Otwórz kluczem',
  'lock-key': 'Zamknij kluczem',
  lockpick: 'Użyj wytrycha',
  'force-pry': 'Wyważ łomem',
  'force-kick': 'Wyważ kopniakiem',
  knock: 'Zapukaj',
  barricade: 'Zabarykaduj',
  unbarricade: 'Zdejmij deskę',
  smash: 'Rozbij',
  'clear-glass': 'Wyczyść ze szkła',
  'climb-through': 'Wejdź przez okno',
  'open-storage': 'Otwórz',
  watch: 'Oglądaj',
} as const satisfies Record<string, string>;

export const FURNITURE_REASONS_PL = {
  'no-power': 'Brak prądu',
  'no-water': 'Brak wody w sieci',
  'no-gas': 'Brak gazu',
  threat: 'Zombie w pobliżu',
  'too-heavy': 'Za ciężki — potrzeba 2 osób',
  locked: 'Zamknięte na klucz',
  'no-key': 'Brak klucza do tego budynku',
  'missing-tool': 'Brak narzędzia',
  'missing-item': 'Brak w ekwipunku',
  'missing-parts': 'Brak gwoździ / desek',
  'invalid-state': 'Niedostępne teraz',
  blocked: 'Miejsce zajęte',
  'out-of-range': 'Za daleko',
  busy: 'Trwa inna czynność',
  tired: 'Za zmęczony',
  'not-tired': 'Nie jesteś zmęczony',
} as const satisfies Record<string, string>;

export const FURNITURE_TYPES_PL = {
  door: 'Drzwi',
  window: 'Okno',
  gate: 'Furtka',
  fridge: 'Lodówka',
  freezer: 'Zamrażarka',
  cabinet: 'Szafka',
  chest: 'Skrzynia',
  crate: 'Skrzynka',
  shelf: 'Regał',
  counter: 'Lada',
  trunk: 'Bagażnik',
  tv: 'Telewizor',
  other: 'Mebel',
} as const satisfies Record<string, string>;

const lookup = (t: Readonly<Record<string, string>>, k: string): string | undefined => t[k];

/** Label of an action id (`lockpick:123` → the `lockpick` label); fallback: the id. */
export function furnitureActionPl(id: string): string {
  const head = id.split(':', 1)[0] ?? id;
  return lookup(FURNITURE_ACTIONS_PL, id) ?? lookup(FURNITURE_ACTIONS_PL, head) ?? id;
}

/** Default Polish text of a reason code; fallback: the code. */
export function furnitureReasonPl(reason: string): string {
  return lookup(FURNITURE_REASONS_PL, reason) ?? reason;
}

/** Polish name of a furniture / edge type id; fallback: the id. */
export function furnitureTypePl(typeId: string): string {
  return lookup(FURNITURE_TYPES_PL, typeId) ?? typeId;
}
