/** `8.44` → `8,4`. */
export const formatKg = (kg: number): string => kg.toFixed(1).replace('.', ',');

/** Item category line of the tooltip (uppercased by CSS). */
export const KIND_LABEL: Record<string, string> = {
  weapon_melee: 'Broń · Biała',
  weapon_ranged: 'Broń palna',
  ammo: 'Amunicja',
  ammo_box: 'Amunicja',
  magazine: 'Magazynek',
  food: 'Jedzenie',
  drink: 'Napój',
  medical: 'Medyczne',
  tool: 'Narzędzie',
  material: 'Materiał',
  clothing: 'Ubranie',
  container: 'Torba',
  literature: 'Książka',
  vhs: 'Kaseta VHS',
  lure: 'Wabik',
  placeable: 'Do postawienia',
  misc: 'Różne',
};
