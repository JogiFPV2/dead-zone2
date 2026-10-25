/** Stroke icons of the HUD v2 chrome (top bar, prompts), 24×24 viewBox (mockup gen_hud_v2.py). */
const PATHS = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  bag: '<path d="M5 8h14l1 13H4zM8 8V6a4 4 0 018 0v2"/>',
  heart: '<path d="M20 8c0 5-8 10-8 10S4 13 4 8a4 4 0 017-2 4 4 0 017-2c1.2.8 2 2.2 2 4z"/>',
  spark: '<path d="M12 2l1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z"/>',
  box: '<path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10"/>',
  pin: '<path d="M12 21s6-5.3 6-11a6 6 0 10-12 0c0 5.7 6 11 6 11z"/><circle cx="12" cy="10" r="2"/>',
  book: '<path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M8 20V7a3 3 0 00-3-3"/>',
  cross: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  // Touch controls (mockup mobile-controls.png).
  swords:
    '<path d="M4 4l11 11M15 15l2.5-1L20 16.5 16.5 20 14 17.5zM20 4L9 15M9 15l-2.5-1L4 16.5 7.5 20 10 17.5z"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7s-5-2-6.5-4.5L3 12.5a1.5 1.5 0 012.5-1.6L8 13"/>',
  run: '<circle cx="14" cy="4.5" r="1.8"/><path d="M10 21l2.5-5.5L10 12l3-4 3 3h3M7 10l3-2M12.5 15.5L16 18v3"/>',
  sneak: '<circle cx="15" cy="6" r="1.8"/><path d="M5 20l4-4 3 1 1-5-4-1-3 3M13 12l4 2 2 4"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  rotate:
    '<path d="M4 12a8 8 0 0113.7-5.6L20 9M20 4v5h-5"/><rect x="7" y="11" width="10" height="7" rx="1"/>',
  target:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
} as const;

export type ChromeIcon = keyof typeof PATHS;

const NS = 'http://www.w3.org/2000/svg';

export function chromeIcon(name: ChromeIcon, size = 13, cls = 'dz-ci'): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name];
  return svg;
}
