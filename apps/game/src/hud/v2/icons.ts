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
