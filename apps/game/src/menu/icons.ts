/** Stroke icons of the menu mockup (gen_menu.py), 24×24, currentColor. */
const PATHS: Record<string, string> = {
  play: '<path d="M7 4l13 8-13 8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  users:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 4 7"/>',
  exit: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  musicOff:
    '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/>',
  yt: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
  arrowl: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>',
};

export function icon(name: string, size: number): string {
  return `<svg class="dzm-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
}

/** Wordmark with the worn filter (SVG turbulence), mockup LOGO. */
export const WORDMARK = `<svg class="dzm-logo-svg" width="780" height="112" viewBox="0 0 780 112" role="img" aria-label="Deadzone"><defs>
<filter id="dzm-wx" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.11 0.07" numOctaves="3" seed="11" result="n"/>
<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -9 6.1" result="m"/>
<feComposite in="SourceGraphic" in2="m" operator="in" result="e"/>
<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="1" seed="3" result="w"/><feDisplacementMap in="e" in2="w" scale="2.5"/></filter></defs>
<text x="0" y="86" font-family="Inter, sans-serif" font-weight="900" font-size="104" letter-spacing="10" fill="#E4E6E3" filter="url(#dzm-wx)">DEADZONE</text></svg>`;
