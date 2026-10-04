/**
 * TEMPORARY Polish labels: content only has i18n keys (`moodle.base.pain.name`) and no language
 * files yet. Replace with the i18n lookup once packs ship texts; unknown ids fall back to a
 * readable form of the id.
 */
const MOODLES: Record<string, string> = {
  'base:bleeding': 'Krwawienie',
  'base:boredom': 'Nuda',
  'base:cold': 'Zimno',
  'base:comfortable': 'Wygoda',
  'base:drunk': 'Upojenie',
  'base:fatigue': 'Zmęczenie',
  'base:heavy-load': 'Obciążenie',
  'base:hot': 'Gorąco',
  'base:hunger': 'Głód',
  'base:infection': 'Infekcja',
  'base:injured': 'Ranny',
  'base:pain': 'Ból',
  'base:panic': 'Panika',
  'base:sick': 'Choroba',
  'base:stress': 'Stres',
  'base:thirst': 'Pragnienie',
  'base:unhappy': 'Smutek',
  'base:well-fed': 'Najedzony',
  'base:wet': 'Przemoczenie',
};

const CONTAINERS: Record<string, string> = {
  'base:kitchen-cabinet': 'Szafka kuchenna',
  'base:kitchen-counter': 'Blat kuchenny',
  'base:fridge': 'Lodówka',
  'base:car-trunk': 'Bagażnik',
  'base:car-glovebox': 'Schowek',
  'base:freezer': 'Zamrażarka',
  'base:wardrobe': 'Szafa',
  'base:dresser': 'Komoda',
  'base:bookshelf': 'Regał na książki',
  'base:wooden-chest': 'Skrzynia',
  'base:crate': 'Skrzynka',
  'base:metal-shelf': 'Regał',
  'base:tool-chest': 'Skrzynka narzędziowa',
  'base:locker': 'Szafka',
  'base:gun-locker': 'Szafa na broń',
  'base:trash-bin': 'Kosz na śmieci',
  'base:dumpster': 'Kontener na śmieci',
  'base:firewood-pile': 'Stos drewna',
};

/** `base:kitchen-knife` → `Kitchen knife` (fallback until i18n). */
export function humanizeId(id: string): string {
  const name = id.replace(/^[^:]*:/, '').replace(/-/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export const moodleName = (id: string): string => MOODLES[id] ?? humanizeId(id);
export const containerName = (type: string | undefined, kind: string): string =>
  type
    ? (CONTAINERS[type] ?? humanizeId(type))
    : kind === 'vehicle-trunk'
      ? 'Bagażnik'
      : kind === 'vehicle-glovebox'
        ? 'Schowek'
        : kind === 'ground'
          ? 'Ziemia'
          : kind === 'corpse'
            ? 'Zwłoki'
            : 'Schowek';

/** `0 → pusto`, `1 przedmiot`, `2–4 przedmioty`, `5+ przedmiotów` (Polish plural rules). */
export function itemCountLabel(n: number): string {
  if (n === 0) return 'pusto';
  if (n === 1) return '1 przedmiot';
  const d = n % 10;
  const dd = n % 100;
  return `${n} ${d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'przedmioty' : 'przedmiotów'}`;
}
