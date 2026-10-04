import type { MarkerColor, MarkerIcon } from './bigmap-model.js';

/** Stroke icons from the Designer's big map mockup (24×24 viewBox). */
const PATHS: Record<string, string> = {
  food: '<path d="M7 4h10v3H7zM6 7h12v13H6z"/><path d="M9 12h6M9 15h4"/>',
  gun: '<path d="M3 8h15l1 3h-6l-1 2h-3l-1 6H5l1-8H3z"/><path d="M18 8V6"/>',
  skull:
    '<path d="M12 3a7 7 0 00-7 7c0 2.5 1.2 4 3 5v3h8v-3c1.8-1 3-2.5 3-5a7 7 0 00-7-7z"/><circle cx="9.3" cy="10.5" r="1.4"/><circle cx="14.7" cy="10.5" r="1.4"/><path d="M10 18v3M14 18v3"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  med: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 15h7M9 18h4"/>',
  water: '<path d="M12 3c3 4.5 6 8 6 11a6 6 0 01-12 0c0-3 3-6.5 6-11z"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4z"/><path d="M4 12h16"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>',
  tool: '<path d="M14.5 5.5a4 4 0 00-5 5L4 16l4 4 5.5-5.5a4 4 0 005-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  ammo: '<path d="M7 9l1.5-5L10 9v11H7zM14 9l1.5-5L17 9v11h-3z"/><path d="M7 13h3M14 13h3"/>',
  danger: '<path d="M12 3L2 20h20z"/><path d="M12 9v5M12 17v.5"/>',
  loot: '<path d="M3 8l9-4 9 4v10l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  pin: '<path d="M12 21s-6-6-6-11a6 6 0 0112 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  trail: '<path d="M4 19c3 0 3-5 6-5s3 4 6 4 3-9 5-12"/>',
  grid: '<path d="M4 4h16v16H4zM4 12h16M12 4v16"/>',
  check: '<path d="M5 12l4 4L19 6"/>',
  target: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  save: '<path d="M5 3h12l3 3v15H4V3z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>',
  mouseL: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6M6 9h6"/>',
  mouseR: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6M12 9h6"/>',
  wheel: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 6v4"/>',
};

export type BigMapIconName = string;

/** Inline SVG string (trusted, static paths only). */
export function bmIcon(name: BigMapIconName, color = 'currentColor', size = 18, stroke = 1.8) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
}

/** Glyph of a protocol marker icon (`MAP_MARKER_ICONS`); unknown ids draw a pin. */
export const MARKER_GLYPH: Record<MarkerIcon, string> = {
  'base:marker-food': 'food',
  'base:marker-danger': 'danger',
  'base:marker-zombies': 'skull',
  'base:marker-loot': 'loot',
  'base:marker-base': 'home',
  'base:marker-car': 'car',
  'base:marker-water': 'water',
  'base:marker-note': 'note',
};
export const markerGlyph = (icon: string): string => MARKER_GLYPH[icon as MarkerIcon] ?? 'pin';

/** Polish names of the marker icons (edit panel tooltips). */
export const MARKER_LABEL: Record<MarkerIcon, string> = {
  'base:marker-food': 'jedzenie',
  'base:marker-danger': 'niebezpieczeństwo',
  'base:marker-zombies': 'zombie',
  'base:marker-loot': 'łup',
  'base:marker-base': 'baza / dom',
  'base:marker-car': 'auto',
  'base:marker-water': 'woda',
  'base:marker-note': 'notatka',
};

/** Legend categories (mockup), protocol icons and colour names. */
export const LEGEND: readonly { icon: MarkerIcon; color: MarkerColor; label: string }[] = [
  { icon: 'base:marker-base', color: 'yellow', label: 'baza / dom' },
  { icon: 'base:marker-food', color: 'green', label: 'jedzenie' },
  { icon: 'base:marker-loot', color: 'white', label: 'łup, amunicja' },
  { icon: 'base:marker-water', color: 'blue', label: 'woda' },
  { icon: 'base:marker-zombies', color: 'red', label: 'zombie, niebezpieczeństwo' },
  { icon: 'base:marker-note', color: 'blue', label: 'notatka' },
];
