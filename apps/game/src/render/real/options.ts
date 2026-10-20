/**
 * Render style flag of the realistic pilot (`render.style = 'real'`). `default` is today's look
 * (vertex colours / palette atlas, `GraphicsStylePass`) and stays the default everywhere: the
 * real path is only built when the flag is on. Testing: `?style=real&quality=low|medium|high`.
 */
export const RENDER_STYLES = ['default', 'real'] as const;
export type RenderStyle = (typeof RENDER_STYLES)[number];

export const REAL_QUALITIES = ['low', 'medium', 'high'] as const;
export type RealQuality = (typeof REAL_QUALITIES)[number];

export interface RenderOptions {
  style: RenderStyle;
  quality: RealQuality;
}

export const DEFAULT_RENDER: RenderOptions = { style: 'default', quality: 'medium' };

const pick = <T extends string>(list: readonly T[], v: string | null, fallback: T): T =>
  (list as readonly string[]).includes(v ?? '') ? (v as T) : fallback;

/** `?style=` values: the render styles plus `classic` for the default look (settings label). */
function urlStyle(v: string | null): RenderStyle | undefined {
  if (v === 'classic') return 'default';
  return (RENDER_STYLES as readonly string[]).includes(v ?? '') ? (v as RenderStyle) : undefined;
}

/**
 * `?style=real|classic&quality=low|medium|high`. The URL wins; without `?style=` the stored
 * setting (Ustawienia › Grafika › Styl grafiki: Realistyczny) decides; anything else keeps the default look.
 */
export function parseRenderOptions(search: string, stored?: RenderStyle): RenderOptions {
  const q = new URLSearchParams(search);
  return {
    style: urlStyle(q.get('style')) ?? stored ?? DEFAULT_RENDER.style,
    quality: pick(REAL_QUALITIES, q.get('quality'), DEFAULT_RENDER.quality),
  };
}
