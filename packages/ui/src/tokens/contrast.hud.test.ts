import { describe, expect, it } from 'vitest';
import { composite, contrastRatio } from './contrast.js';
import { tokens } from './tokens.generated.js';

/** Text of the new HUD components ≥ 4.5:1 over every mood's scene (spec §4 backgrounds). */
const SCENES = { night: '#0D1112', dusk: '#3B3A3F', day: '#7D8588' };
const { color: c } = tokens;
const rgb = (v: string, backdrop: string): string => {
  const { r, g, b } = composite(v, backdrop);
  return `rgb(${r}, ${g}, ${b})`;
};

interface Pair {
  name: string;
  fg: string;
  /** Surfaces from the scene up (e.g. glass panel, then a key badge on it). */
  on: string[];
}

/** Panels: bg.hud (glass) and bg.panel ("Rozmycie HUD" off). */
const glass = (name: string, fg: string, extra: string[] = []): Pair[] => [
  { name: `${name} (glass)`, fg, on: [c.bg.hud, ...extra] },
  { name: `${name} (no blur)`, fg, on: [c.bg.panel, ...extra] },
];

const PAIRS: Pair[] = [
  // Clock
  ...glass('clock time', c.text.primary),
  ...glass('clock day', c.text.muted),
  // Toast (bg.hud, spec: no blur variant)
  { name: 'toast text', fg: c.text.primary, on: [c.bg.hud] },
  { name: 'toast damage value', fg: c.danger.text, on: [c.bg.hud] },
  { name: 'toast gain value', fg: c.success.text, on: [c.bg.hud] },
  { name: 'toast warning value', fg: c.warning.text, on: [c.bg.hud] },
  // Key hints
  ...glass('hints', c.text.muted),
  // ObjectiveCard
  ...glass('objective header', c.accent.base),
  ...glass('objective completed header', c.success.text),
  ...glass('objective step', c.text.muted),
  ...glass('objective title', c.text.primary),
  ...glass('objective J badge', c.text.primary, [c.bg.key]),
];

describe('new HUD components: text ≥ 4.5:1 in every mood', () => {
  for (const pair of PAIRS) {
    it(pair.name, () => {
      for (const [mood, scene] of Object.entries(SCENES)) {
        const layers = pair.on.slice(0, -1).reduce((back, layer) => rgb(layer, back), scene);
        const ratio = contrastRatio(pair.fg, pair.on.at(-1) ?? scene, layers);
        expect(ratio, `${pair.name} @ ${mood}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
