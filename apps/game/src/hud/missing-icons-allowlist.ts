/**
 * Przedmioty z `packages/content` bez wypieczonej ikony w `public/icons`. Pusta od #189/#190 (wszystkie
 * przedmioty mają ikony). Lista ma tylko maleć: nowy przedmiot przychodzi z ikoną, a wyjątek tu to ostateczność.
 */
export const MISSING_ICONS_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  // Meble stałe stawiane przez mapę (`items/furniture-fixtures.json`): nie trafiają do ekwipunku,
  // na mapie mają model. Ikony dorobi Designer; wtedy usunąć stąd.
  'base:range',
  'base:bathtub',
  'base:shower',
  'base:vcr',
  'base:radio-set',
]);
