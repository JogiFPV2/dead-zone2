/** Stroke icons of the furniture UI (24×24 viewBox, same style as the vehicle UI icons). */
export const FURN_ICONS = {
  fridge: '<rect x="6" y="2.5" width="12" height="19" rx="1.6"/><path d="M6 9h12M9 5v2M9 12v3"/>',
  bed: '<path d="M3 18V7M3 13h18v5M21 18v-3M3 13V10h7a3 3 0 013 3"/><circle cx="7" cy="11" r="1.4"/>',
  sofa: '<path d="M5 11V8a2 2 0 012-2h10a2 2 0 012 2v3"/><path d="M3 12a2 2 0 014 0v2h10v-2a2 2 0 014 0v5H3z"/><path d="M5 17v2M19 17v2"/>',
  tv: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M8 3l4 3 4-3M8 21h8"/>',
  radio:
    '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M7 8l10-5"/><circle cx="8.5" cy="14" r="2.5"/><path d="M14 12h4M14 15h4"/>',
  stove:
    '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 9h16"/><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><rect x="7.5" y="12" width="9" height="6" rx="1"/>',
  door: '<path d="M6 21V3h12v18M4 21h16"/><circle cx="15" cy="12" r="1"/>',
  window: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
  switch:
    '<rect x="7" y="3" width="10" height="18" rx="2"/><rect x="10" y="7" width="4" height="6" rx="1"/>',
  water: '<path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z"/>',
  box: '<rect x="3" y="5" width="18" height="15" rx="1"/><path d="M3 9h18M10 13h4"/>',
  hand: '<path d="M7 11V5a1.5 1.5 0 013 0v5M10 10V4a1.5 1.5 0 013 0v6M13 10V5a1.5 1.5 0 013 0v6M16 11V8a1.5 1.5 0 013 0v6c0 4-3 7-7 7s-6-2-7.5-5L3 13a1.5 1.5 0 012.5-1.5L7 13"/>',
  snow: '<path d="M12 2v20M3.5 7l17 10M20.5 7l-17 10M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  moon: '<path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z"/>',
  tape: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><path d="M10 12h4"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-3 2-4 2-6 1.5 1 2 2 2 3 1-2 1-5 1-7z"/>',
  power: '<path d="M12 3v8M7 6a7 7 0 1010 0"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  floor: '<path d="M3 15l9-5 9 5-9 5z"/><path d="M7.5 12.5l9 5M16.5 12.5l-9 5"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M18 12v3M15 12v2"/>',
  tool: '<path d="M14.7 6.3a4 4 0 00-5.4 5.2L4 16.8 7.2 20l5.3-5.3a4 4 0 005.2-5.4l-2.4 2.4-2.4-.6-.6-2.4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l9-11h-6z"/>',
  zombie:
    '<circle cx="12" cy="6" r="3"/><path d="M12 9v7M12 16l-3 5M12 16l3 5M12 11l6-1M12 12l5 2"/>',
  weight: '<path d="M7 8h10l3 12H4z"/><circle cx="12" cy="5.5" r="2.5"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M9 21l3-7 3 3v4M7 12l3-4h4l3 4M12 14l-1-6"/>',
  empty: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M8 15l8-6"/>',
  ban: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
  dot: '<circle cx="12" cy="12" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
} as const;

export type FurnIcon = keyof typeof FURN_ICONS;

/** Inline SVG markup of icon `name` (stroke = currentColor). */
export function furnIcon(name: FurnIcon, size = 14): string {
  return `<svg class="dz-fm__ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${FURN_ICONS[name]}</svg>`;
}
