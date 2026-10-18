/**
 * Przedmioty z `packages/content` bez wypieczonej ikony w `public/icons`. Pusta od #189/#190 (wszystkie
 * przedmioty mają ikony). Lista ma tylko maleć: nowy przedmiot przychodzi z ikoną, a wyjątek tu to ostateczność.
 */
export const MISSING_ICONS_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // Meble bez ikony (Designer): kuchenka gazowa jako przedmiot, krzesło, fotel, włącznik światła,
  // stół, lampa stojąca, lampka biurkowa, toaleta.
  'base:armchair',
  'base:chair',
  'base:desk-lamp',
  'base:floor-lamp',
  'base:gas-stove',
  'base:light-switch',
  'base:table',
  'base:toilet',
]);
