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
  ...['base:kitchen-cabinet', 'base:room-kitchen'].flatMap((at) => [
    { at, item: 'base:bottle', reason: 'pusta butelka po napoju zostaje w szafce' },
  ]),
  { at: 'base:kitchen-cabinet', item: 'base:can-opener', reason: 'otwieracz leży przy puszkach' },
  ...['base:kitchen-counter', 'base:room-kitchen'].flatMap((at) => [
    { at, item: 'base:duct-tape', reason: 'taśma w szufladzie „na wszystko”' },
    { at, item: 'base:rubber-hose', reason: 'wężyk w szufladzie „na wszystko”' },
  ]),
  ...['base:kitchen-sink', 'base:bathroom-sink', 'base:room-bathroom'].flatMap((at) => [
    { at, item: 'base:duct-tape', reason: 'taśma do doraźnej naprawy rury pod zlewem' },
  ]),
  ...['base:wardrobe', 'base:dresser', 'base:room-bedroom', 'base:room-living-room'].flatMap(
    (at) => [{ at, item: 'base:gloves', reason: 'rękawiczki trzyma się z ubraniami' }],
  ),
  ...['base:shop-counter', 'base:metal-shelf', 'base:room-shop'].flatMap((at) => [
    { at, item: 'base:bottle', reason: 'butelki zwrotne w sklepie' },
  ]),
  ...['base:shop-counter', 'base:room-shop'].flatMap((at) => [
    { at, item: 'base:can-opener', reason: 'spożywczy sprzedaje otwieracze' },
  ]),
  ...['base:room-shop'].flatMap((at) => [
    { at, item: 'base:duct-tape', reason: 'spożywczy ma drobną chemię i taśmę' },
    { at, item: 'base:painkillers', reason: 'leki bez recepty przy kasie' },
    { at, item: 'base:vitamins', reason: 'witaminy na półce spożywczego' },
  ]),
  {
    at: 'base:shop-counter',
    item: 'base:towel',
    reason: 'ręczniki na ladzie spożywczego i apteki',
  },
  ...['base:flashlight', 'base:battery', 'base:electronics-scrap'].map((item) => ({
    at: 'base:tool-chest',
    item,
    reason: 'latarka, baterie i drobna elektronika w skrzynce narzędziowej',
  })),
];

export const TABLE_EXCEPTIONS: readonly TableException[] = [];
