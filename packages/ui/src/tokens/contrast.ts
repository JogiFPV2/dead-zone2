/** WCAG 2.x contrast helpers for token checks (hex `#RRGGBB` and `rgba()` values). */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseColor(value: string): Rgb & { a: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const m = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (!m) throw new Error(`unsupported colour: ${value}`);
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/** Flattens a (semi-transparent) colour onto an opaque backdrop. */
export function composite(value: string, backdrop: string): Rgb {
  const c = parseColor(value);
  const b = parseColor(backdrop);
  const mix = (x: number, y: number) => x * c.a + y * (1 - c.a);
  return { r: mix(c.r, b.r), g: mix(c.g, b.g), b: mix(c.b, b.b) };
}

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = ({ r, g, b }: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/**
 * Contrast of text `fg` on background `bg`, both composited onto `backdrop` (what is behind the
 * HUD: the game scene). Result 1..21.
 */
export function contrastRatio(fg: string, bg: string, backdrop = '#000000'): number {
  const base = composite(bg, backdrop);
  const baseHex = `rgb(${base.r}, ${base.g}, ${base.b})`;
  const a = relativeLuminance(composite(fg, baseHex));
  const b = relativeLuminance(base);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
