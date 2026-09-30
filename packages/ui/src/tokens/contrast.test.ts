import { describe, expect, it } from 'vitest';
import { chipModeAt, moodBlendAt } from '../mood/vignette.js';
import type { HudMood } from '../mood/mood.js';
import { contrastRatio, parseColor } from './contrast.js';
import { tokens } from './tokens.generated.js';

/** Scene colours behind the HUD: night / dusk fog / day background (spec §4) and the extremes. */
const BACKDROPS = {
  black: '#000000',
  night: '#0D1112',
  dusk: '#3B3A3F',
  day: '#7D8588',
  white: '#FFFFFF',
};
const SCENE: Record<HudMood, string> = {
  night: BACKDROPS.night,
  dusk: BACKDROPS.dusk,
  day: BACKDROPS.day,
};
const MOODS = ['night', 'dusk', 'day'] as const;
const AA = 4.5;

const hex = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
/** Scene colour for a game time: keyframe scene colours blended like the vignette. */
function sceneAt(minutes: number): string {
  const { from, to, t } = moodBlendAt(minutes);
  const a = parseColor(SCENE[from]);
  const b = parseColor(SCENE[to]);
  return `#${hex(a.r + (b.r - a.r) * t)}${hex(a.g + (b.g - a.g) * t)}${hex(a.b + (b.b - a.b) * t)}`;
}
/** Colour with its alpha multiplied (pulse trough of an opacity animation). */
function fade(value: string, k: number): string {
  const { r, g, b, a } = parseColor(value);
  return `rgba(${r}, ${g}, ${b}, ${a * k})`;
}
/** OKLCH chroma of an sRGB colour. */
function chroma(value: string): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const { r: R, g: G, b: B } = parseColor(value);
  const [r, g, b] = [lin(R), lin(G), lin(B)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.hypot(A, Bb);
}

describe('contrast helper', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });
  it('blends the scene between keyframes', () => {
    expect(sceneAt(12 * 60)).toBe('#7d8588');
    expect(sceneAt(19 * 60 + 30)).toBe('#3b3a3f');
    expect(sceneAt(0)).toBe('#0d1112');
  });
});

describe('threat banners (Designer, answer 8 and final fix 2)', () => {
  const high = tokens.color.threat.high;
  const critical = tokens.color.threat.critical;
  const pulseTrough = Number(tokens.motion.pulse.threat);
  for (const [name, backdrop] of Object.entries(BACKDROPS)) {
    it(`high: text on bg ≥ 4.5:1 over a ${name} scene`, () => {
      expect(contrastRatio(high.text, high.bg, backdrop)).toBeGreaterThanOrEqual(AA);
    });
  }
  for (const mood of MOODS) {
    it(`critical: text on bg ≥ 4.5:1 over the ${mood} scene, also at the pulse trough`, () => {
      expect(contrastRatio(critical.text, critical.bg, SCENE[mood])).toBeGreaterThanOrEqual(AA);
      expect(
        contrastRatio(critical.text, fade(critical.bg, pulseTrough), SCENE[mood]),
      ).toBeGreaterThanOrEqual(AA);
    });
  }
  it('critical is more saturated than high (OKLCH chroma) and has a visible border', () => {
    expect(chroma(critical.bg)).toBeGreaterThan(chroma(high.bg) * 1.2);
    expect(critical.border).toBe(tokens.color.danger.bright);
  });
  it('high is darker than the old danger.banner it replaces', () => {
    expect(contrastRatio(high.text, tokens.color.danger.banner, BACKDROPS.night)).toBeLessThan(AA);
  });
});

describe('moodle chips ≥ 4.5:1 in every mood (Designer, final fix 1)', () => {
  const chips = (['neg', 'pos'] as const).flatMap((polarity) =>
    ([1, 2, 3, 4] as const).map((level) => ({
      name: `${polarity}.${level}`,
      ...tokens.color.moodle[polarity][level],
    })),
  );

  for (const chip of chips) {
    it(`${chip.name}: night set over night and dusk, day set over day, dusk and night`, () => {
      for (const mood of ['night', 'dusk'] as const)
        expect(contrastRatio(chip.text, chip.bg.$value, SCENE[mood])).toBeGreaterThanOrEqual(AA);
      for (const mood of MOODS)
        expect(contrastRatio(chip.text, chip.bg.day, SCENE[mood])).toBeGreaterThanOrEqual(AA);
    });
    it(`${chip.name}: day bg keeps the night hue at alpha 0.92`, () => {
      const day = parseColor(chip.bg.day);
      expect(day.a).toBe(0.92);
    });
  }

  it('every chip and the +N chip pass along a whole game day (5 min steps)', () => {
    const { overflow } = tokens.color.chip;
    for (let m = 0; m < 24 * 60; m += 5) {
      const scene = sceneAt(m);
      const mode = chipModeAt(m);
      for (const chip of chips) {
        const bg = mode === 'day' ? chip.bg.day : chip.bg.$value;
        expect(contrastRatio(chip.text, bg, scene), `${chip.name} @${m}min`).toBeGreaterThanOrEqual(
          AA,
        );
      }
      expect(contrastRatio(overflow.text, overflow.bg, scene)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('day chips get the dark hairline border', () => {
    expect(tokens.border.chip.day).toBe('1px solid rgba(0, 0, 0, 0.55)');
  });
});
