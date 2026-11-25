import { FARM_ACTIONS_PL, FARM_TYPES_PL } from './farm-labels.js';
export { FURNITURE_REASON_DETAILS_PL } from './reason-details.js';

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
  'insert-tape': 'Włóż kasetę',
  sleep: 'Śpij',
  'sleep-until:morning': 'Śpij do rana',
  'sleep-until': 'Śpij',
  rest: 'Odpocznij',
  read: 'Czytaj',
  'listen-radio': 'Słuchaj radia',
  'watch-vhs': 'Odtwórz kasetę',
  cook: 'Gotuj',
  'light-on': 'Zapal światło',
  'light-off': 'Zgaś światło',
  'close-curtains': 'Zasłoń okno',
  'open-curtains': 'Odsłoń okno',
  'drink-tap': 'Napij się z kranu',
  wash: 'Umyj się',
  shower: 'Weź prysznic',
  bath: 'Weź kąpiel',
  push: 'Pchnij',
  pull: 'Ciągnij',
  rotate: 'Obróć',
  ...FARM_ACTIONS_PL,
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
  fixed: 'Przymocowane',
  'wrong-side': 'Stań przy boku mebla',
  'no-space': 'Brak miejsca',
  wall: 'Ściana na drodze',
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
  bed: 'Łóżko',
  sofa: 'Kanapa',
  seat: 'Siedzisko',
  radio: 'Radio',
  stove: 'Kuchenka',
  'light-switch': 'Włącznik światła',
  sink: 'Zlew / umywalka',
  shower: 'Prysznic',
  bath: 'Wanna',
  vcr: 'Magnetowid',
  other: 'Mebel',
  ...FARM_TYPES_PL,
} as const satisfies Record<string, string>;

const lookup = (t: Readonly<Record<string, string>>, k: string): string | undefined => t[k];

/** Label of an action id (`lockpick:123` → the `lockpick` label); fallback: the id. */
export function furnitureActionPl(id: string): string {
  const head = id.split(':', 1)[0] ?? id;
  const hours = /^sleep-until:(\d+)$/.exec(id)?.[1];
  if (hours) return `Śpij ${hours} godz.`;
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
