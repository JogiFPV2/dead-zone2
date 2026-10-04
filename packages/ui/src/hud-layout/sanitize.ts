import { HUD_LAYOUT_SLOTS } from './ids.js';
import { HUD_LAYOUT_VERSION, hudElementLayoutSchema, type HudLayout } from './schema.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Untrusted saved layout → sparse valid layout: wrong version / shape → empty, invalid elements
 * dropped (they fall back to defaults in `resolveLayout`), unknown ids ignored.
 */
export function sanitizeHudLayout(saved: unknown): HudLayout {
  const out: HudLayout = { version: HUD_LAYOUT_VERSION, elements: {} };
  if (!isRecord(saved) || saved.version !== HUD_LAYOUT_VERSION || !isRecord(saved.elements)) {
    return out;
  }
  for (const id of HUD_LAYOUT_SLOTS) {
    const r = hudElementLayoutSchema.safeParse(saved.elements[id]);
    if (r.success) out.elements[id] = r.data;
  }
  return out;
}
