/** Stroke icons of the vehicle UI (24×24 viewBox): status glyphs; car items use the atlas PNGs. */
export const VEH_ICONS = {
  car: '<path d="M4 15l1.6-5A2 2 0 017.5 8.6h9a2 2 0 011.9 1.4L20 15"/><rect x="3" y="15" width="18" height="4" rx="1.2"/><circle cx="7" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M18 12v3M15 12v2"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l9-11h-6z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 017.6-1.7"/>',
  seat: '<path d="M8 4h4l1 9h5l1 7M8 4L7 14h6M10 14v6"/>',
  trunk: '<path d="M3 12h18v6H3zM5 12l2-4h10l2 4M9 15h6"/>',
  fuel: '<path d="M6 21V7l3-4h7l2 3v15z"/><path d="M9 3l2 3h7M10 11h5M10 15h5"/>',
  hose: '<path d="M4 18c3 0 3-4 6-4s3 4 6 4 3-4 4-4M4 18v2M20 14v-3"/>',
  pump: '<path d="M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16M4 21h12M7 7h6v4H7zM15 9h2l2 2v7a1.5 1.5 0 01-3 0v-3h-1"/>',
  wrench:
    '<path d="M14.7 6.3a4 4 0 00-5.4 5.2L4 16.8 7.2 20l5.3-5.3a4 4 0 005.2-5.4l-2.4 2.4-2.4-.6-.6-2.4z"/>',
  engine: '<path d="M4 10h3l2-2h5l2 2h2v3h2v-2h1v6h-1v-2h-2v3h-3l-2 2H8l-2-2H4z"/>',
  tire: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  window: '<path d="M5 17l2-8h10l2 8z"/>',
  body: '<rect x="4" y="7" width="16" height="11" rx="2"/><path d="M8 7v11M16 7v11"/>',
  battery:
    '<rect x="3" y="8" width="18" height="11" rx="1.2"/><path d="M7 8V6h3v2M14 8V6h3v2M7 13h3M15 12v3M13.5 13.5h3"/>',
  tank: '<rect x="4" y="9" width="16" height="9" rx="3"/><path d="M8 9V7h3"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  horn: '<path d="M4 10v4h3l6 4V6L7 10zM16 9a4 4 0 010 6"/>',
  light: '<path d="M10 6a6 6 0 000 12h2V6zM15 8h5M15 12h5M15 16h5"/>',
  gauge: '<path d="M4 17a8 8 0 1116 0M12 17l4-5"/>',
  crank: '<path d="M18 12a6 6 0 11-3-5.2M18 4v3h-3"/>',
  power: '<path d="M12 3v8M7 6a7 7 0 1010 0"/>',
} as const;

export type VehIcon = keyof typeof VEH_ICONS;

/** Inline SVG markup of icon `name` (stroke = currentColor). */
export function vehIcon(name: VehIcon, size = 14): string {
  return `<svg class="dz-vh__ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${VEH_ICONS[name]}</svg>`;
}
