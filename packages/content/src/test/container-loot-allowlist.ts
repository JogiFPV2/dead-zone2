/**
 * Jawne wyjątki od `lootAccepts` schowków (test `container-loot.test.ts`). Każdy wpis musi mieć
 * powód; nieużywany wpis też psuje test, żeby lista nie puchła.
 */
export interface ItemException {
  /** Typ schowka albo typ pomieszczenia (`base:room-*`), w którym przedmiot jest OK. */
  at: string;
  item: string;
  reason: string;
}

/** Tabelę pomieszczenia wolno włożyć do schowka spoza jego `lootAccepts` (oś pomieszczenia zostaje). */
export interface TableException {
  table: string;
  container: string;
  reason: string;
}

export const ITEM_EXCEPTIONS: readonly ItemException[] = [
  ...['base:kitchen-counter', 'base:room-kitchen'].flatMap((at) => [
    { at, item: 'base:kitchen-knife', reason: 'nóż kuchenny w kuchennej szufladzie to sztućce' },
    { at, item: 'base:meat-cleaver', reason: 'tasak leży w kuchni razem z nożami' },
  ]),
  {
    at: 'base:kitchen-cabinet',
    item: 'base:potato',
    reason: 'ziemniaki trzyma się w spiżarce, nie w lodówce',
  },
];

export const TABLE_EXCEPTIONS: readonly TableException[] = [];
