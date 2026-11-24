import { describe, expect, it } from 'vitest';
import { DEFAULT_HUD_LAYOUT, HUD_LAYOUT_REFERENCE } from './defaults.js';
import { HUD_ELEMENT_IDS, layoutSlotFor, type HudLayoutSlot } from './ids.js';
import { clampToViewport } from './ops.js';
import { hudLayoutSchema } from './schema.js';

/**
 * HUD v3 as styled in apps/game/src/hud (hud-layout.css, hud-v3.css, layout/hud-slots.css,
 * vehicles/vehicle-hud.css): anchor and px offsets from that edge at 1280×720.
 */
const V3: Record<HudLayoutSlot, { anchor: string; x: number; y: number }> = {
  minimap: { anchor: 'tr', x: 18, y: 47 },
  topbar: { anchor: 'tl', x: 0, y: 0 },
  status: { anchor: 'tl', x: 18, y: 48 },
  hotbar: { anchor: 'br', x: 18, y: 18 },
  itemlog: { anchor: 'tr', x: 18, y: 196 },
  weapon: { anchor: 'br', x: 18, y: 73 },
  threat: { anchor: 'tc', x: 0, y: 40 },
  hints: { anchor: 'bl', x: 18, y: 18 },
  osmmap: { anchor: 'bl', x: 18, y: 52 },
};

describe('DEFAULT_HUD_LAYOUT matches HUD v3 styles', () => {
  const vp = HUD_LAYOUT_REFERENCE;
  const size = { w: 100, h: 40 };

  it('passes the schema with every element at its v3 anchor and offset', () => {
    expect(hudLayoutSchema.safeParse(DEFAULT_HUD_LAYOUT).success).toBe(true);
    for (const id of HUD_ELEMENT_IDS) {
      const d = DEFAULT_HUD_LAYOUT.elements[layoutSlotFor(id)];
      const want = V3[layoutSlotFor(id)];
      expect(d.anchor, id).toBe(want.anchor);
      expect(d.x * vp.w, id).toBeCloseTo(want.x);
      expect(d.y * vp.h, id).toBeCloseTo(want.y);
      expect([d.scale, d.opacity, d.visible], id).toEqual([1, 1, true]);
    }
  });

  it('clampToViewport puts status at 18/48 and hints in the bottom-left corner', () => {
    const status = clampToViewport(DEFAULT_HUD_LAYOUT.elements.status, vp, size);
    expect([status.left, status.top]).toEqual([18, 48]);
    const hints = clampToViewport(DEFAULT_HUD_LAYOUT.elements.hints, vp, size);
    expect(hints.left).toBeCloseTo(18);
    expect(hints.top).toBeCloseTo(vp.h - 18 - size.h);
    const weapon = clampToViewport(DEFAULT_HUD_LAYOUT.elements.weapon, vp, size);
    expect(weapon.left).toBeCloseTo(vp.w - 18 - size.w);
    expect(weapon.top).toBeCloseTo(vp.h - 73 - size.h);
  });

  it('every default stays on screen at 1280×720, 1920×1080 and 3840×2160', () => {
    for (const v of [vp, { w: 1920, h: 1080 }, { w: 3840, h: 2160 }]) {
      for (const d of Object.values(DEFAULT_HUD_LAYOUT.elements)) {
        const r = clampToViewport(d, v, size);
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.top).toBeGreaterThanOrEqual(0);
        expect(r.left + r.width).toBeLessThanOrEqual(v.w);
        expect(r.top + r.height).toBeLessThanOrEqual(v.h);
      }
    }
  });
});
