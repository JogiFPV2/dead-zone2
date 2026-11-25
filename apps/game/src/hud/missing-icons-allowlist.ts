/**
 * Przedmioty z `packages/content` bez wypieczonej ikony w `public/icons`. Pusta od #189/#190 (wszystkie
 * przedmioty mają ikony). Lista ma tylko maleć: nowy przedmiot przychodzi z ikoną, a wyjątek tu to ostateczność.
 */
export const MISSING_ICONS_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // Farming (25.11): icons not rendered yet.
  'base:hoe',
  'base:garden-rake',
  'base:watering-can',
  'base:bucket',
  'base:glass',
  'base:seeds-carrot',
  'base:seeds-cabbage',
  'base:seeds-onion',
  'base:seeds-tomato',
  'base:seeds-cucumber',
  'base:seeds-beans',
  'base:seeds-strawberry',
  'base:tomato',
  'base:cucumber',
  'base:onion',
  'base:green-beans',
  'base:strawberry',
]);
