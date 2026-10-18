import { z } from 'zod';

/**
 * Rodzaj budynku wyliczalny z typów jego pomieszczeń (sim zbiera je po `roomBuildings`), w kolejności
 * priorytetu: pierwszy wiersz, którego pomieszczenie występuje w budynku, wygrywa. Nazwy rodzajów to
 * podzbiór `BUILDING_KINDS` generatora (`tools/map/src/osm/types.ts`; pilnuje tego test w `tools/map`).
 *
 * - budynki publiczne przed resztą (szpital ma też aptekę i biura, szkoła i policja — biura);
 * - sklepy i usługi przed domem (sklep z mieszkaniami na piętrze to sklep);
 * - dom przed biurem, magazynem i garażem (dom z garażem to dom);
 * - garaż (też szopa) tylko, gdy w budynku nie ma nic ważniejszego.
 *
 * Generator ma rodzaje, których nie da się odróżnić po pomieszczeniach: `block` i `kostka` wychodzą
 * jako `house`, `station` jako `shop`, `fire-station` jako `office`, `shed` jako `garage`; `church`
 * (sama `base:room-hall`) nie ma rodzaju i dostaje `exteriorLockedChance`.
 */
export const BUILDING_KIND_ROOMS = [
  ['hospital', ['base:room-hospital']],
  ['school', ['base:room-school']],
  ['police', ['base:room-police']],
  ['pharmacy', ['base:room-pharmacy']],
  [
    'shop',
    ['base:room-shop', 'base:room-video-store', 'base:room-gun-store', 'base:room-bookstore'],
  ],
  ['fuel', ['base:room-gas-station']],
  ['gym', ['base:room-gym']],
  ['house', ['base:room-living-room', 'base:room-kitchen', 'base:room-bedroom']],
  ['office', ['base:room-office']],
  ['industrial', ['base:room-warehouse']],
  ['garage', ['base:room-garage']],
  ['ruin', ['base:room-ruin']],
] as const;

export type BuildingKind = (typeof BUILDING_KIND_ROOMS)[number][0];
export const BUILDING_KINDS = BUILDING_KIND_ROOMS.map<BuildingKind>(([k]) => k);

/**
 * Klucz szansy zamka drzwi zewnętrznych: rodzaj budynku albo `gate` — brama / furtka w ogrodzeniu
 * (osobny typ krawędzi, niezależnie od budynku).
 */
export const LockKindSchema = z.enum(['gate', ...BUILDING_KINDS]);
export type LockKind = z.infer<typeof LockKindSchema>;
