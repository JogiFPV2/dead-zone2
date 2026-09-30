/** SVG path data (24×24 viewBox, stroke 2, round caps) taken from HUD A mockup (dz-html/iso-hud-a.html). */
export const iconPaths = {
  heart: [
    'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z',
  ],
  drop: ['M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z'],
  cutlery: ['M7 3v7a2 2 0 0 0 2 2M11 3v7a2 2 0 0 1-2 2v9M16 3c-2 2-2 7 0 9v9'],
  bolt: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  warning: ['M12 3l10 18H2z', 'M12 10v5M12 18v.01'],
  check: ['M4 12l5 5 11-11'],
  info: ['M12 11v6M12 7.5v.01'],
  target: [],
  knife: ['M4 20l8-8', 'M12 12l6.5-6.5c1-1 2.5 0 1.8 1.2L15 15z'],
  crowbar: ['M5 20L17 5c1.2-1.4 3.2-.8 3 1.2'],
  bottle: ['M10 2h4v4l2 3v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3z', 'M8 13h8'],
  can: ['M6 8h12M6 16h12'],
} as const satisfies Record<string, readonly string[]>;

/** Extra primitives that are not paths. */
export const iconShapes: Partial<Record<IconName, readonly Shape[]>> = {
  info: [{ tag: 'circle', attrs: { cx: '12', cy: '12', r: '9' } }],
  target: [
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '8' } },
    { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } },
  ],
  can: [{ tag: 'rect', attrs: { x: '6', y: '4', width: '12', height: '16', rx: '2' } }],
};

export type IconName = keyof typeof iconPaths;

export interface Shape {
  tag: 'circle' | 'rect';
  attrs: Readonly<Record<string, string>>;
}
