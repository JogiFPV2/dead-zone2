import { describe, expect, it } from 'vitest';
import { DEFAULT_HUD_LAYOUT } from './defaults.js';
import { HUD_ELEMENT_IDS, HUD_LAYOUT_SLOTS, isHudElementId, layoutSlotFor } from './ids.js';
import { clampToViewport, resetAll, resetElement, resolveLayout } from './ops.js';
import { sanitizeHudLayout } from './sanitize.js';
import { hudElementLayoutSchema, hudLayoutSchema, type HudElementLayout } from './schema.js';

const el = (p: Partial<HudElementLayout> = {}): HudElementLayout => ({
  anchor: 'tl',
  x: 0.1,
  y: 0.1,
  scale: 1,
  opacity: 1,
  visible: true,
  ...p,
});

describe('schema', () => {
  it('DEFAULT_HUD_LAYOUT passes the schema and every element id has a default', () => {
    expect(hudLayoutSchema.safeParse(DEFAULT_HUD_LAYOUT).success).toBe(true);
    for (const id of HUD_ELEMENT_IDS) {
      const d = DEFAULT_HUD_LAYOUT.elements[layoutSlotFor(id)];
      expect(d, id).toBeDefined();
      expect(hudElementLayoutSchema.safeParse(d).success, id).toBe(true);
    }
    expect(Object.keys(DEFAULT_HUD_LAYOUT.elements).sort()).toEqual([...HUD_LAYOUT_SLOTS].sort());
  });

  it('vehicle shares the weapon slot; every other id is its own slot', () => {
    expect(layoutSlotFor('vehicle')).toBe('weapon');
    expect(HUD_LAYOUT_SLOTS).not.toContain('vehicle');
    for (const id of HUD_ELEMENT_IDS) {
      if (id !== 'vehicle') expect(layoutSlotFor(id)).toBe(id);
    }
    expect(HUD_LAYOUT_SLOTS.length).toBe(HUD_ELEMENT_IDS.length - 1);
    expect(hudLayoutSchema.parse({ version: 1, elements: { vehicle: el() } }).elements).toEqual({});
  });

  it('ids are unique', () => {
    expect(new Set(HUD_ELEMENT_IDS).size).toBe(HUD_ELEMENT_IDS.length);
    expect(isHudElementId('minimap')).toBe(true);
    expect(isHudElementId('nope')).toBe(false);
  });

  it('checks ranges', () => {
    const ok = (p: Partial<HudElementLayout>) => hudElementLayoutSchema.safeParse(el(p)).success;
    expect(ok({ scale: 0.5 })).toBe(true);
    expect(ok({ scale: 1.5 })).toBe(true);
    expect(ok({ scale: 0.49 })).toBe(false);
    expect(ok({ scale: 1.51 })).toBe(false);
    expect(ok({ opacity: 0.2 })).toBe(true);
    expect(ok({ opacity: 0.19 })).toBe(false);
    expect(ok({ opacity: 1.01 })).toBe(false);
    expect(ok({ x: 0, y: 1 })).toBe(true);
    expect(ok({ x: -0.01 })).toBe(false);
    expect(ok({ y: 1.01 })).toBe(false);
    expect(ok({ x: Number.NaN })).toBe(false);
    // Centred axis: signed shift −0.5..0.5.
    expect(ok({ anchor: 'tc', x: -0.3 })).toBe(true);
    expect(ok({ anchor: 'tc', x: 0.6 })).toBe(false);
    expect(ok({ anchor: 'cl', y: -0.5 })).toBe(true);
    expect(ok({ anchor: 'cl', y: 0.51 })).toBe(false);
    expect(hudElementLayoutSchema.safeParse({ ...el(), anchor: 'cc' }).success).toBe(false);
  });

  it('visible defaults to true; unknown ids and keys are stripped', () => {
    const noVisible: Partial<HudElementLayout> = el();
    delete noVisible.visible;
    const r = hudLayoutSchema.parse({
      version: 1,
      extra: 1,
      elements: { minimap: { ...noVisible, junk: 2 }, futureWidget: el() },
    });
    expect(r.elements.minimap?.visible).toBe(true);
    expect(r.elements.minimap).not.toHaveProperty('junk');
    expect(r.elements).not.toHaveProperty('futureWidget');
    expect(r).not.toHaveProperty('extra');
    expect(hudLayoutSchema.safeParse({ version: 2, elements: {} }).success).toBe(false);
  });
});

describe('ops', () => {
  it('resolveLayout merges over defaults; invalid → default', () => {
    const r = resolveLayout({
      version: 1,
      elements: { minimap: el({ scale: 1.2 }), status: el({ scale: 9 }), ghost: el() },
    });
    expect(r.elements.minimap.scale).toBe(1.2);
    expect(r.elements.status).toEqual(DEFAULT_HUD_LAYOUT.elements.status);
    expect(r.elements.hotbar).toEqual(DEFAULT_HUD_LAYOUT.elements.hotbar);
    expect(r.elements).not.toHaveProperty('ghost');
    for (const bad of [
      undefined,
      null,
      42,
      'x',
      [],
      { version: 2, elements: {} },
      { version: 1 },
    ]) {
      expect(resolveLayout(bad)).toEqual(DEFAULT_HUD_LAYOUT);
    }
  });

  it('sanitizeHudLayout keeps only valid elements', () => {
    expect(
      sanitizeHudLayout({ version: 1, elements: { status: el(), minimap: { anchor: 'tl' } } }),
    ).toEqual({ version: 1, elements: { status: el() } });
  });

  it('resetElement / resetAll return copies of the defaults', () => {
    const changed = resolveLayout({ version: 1, elements: { status: el(), minimap: el() } });
    const r = resetElement(changed, 'status');
    expect(r.elements.status).toEqual(DEFAULT_HUD_LAYOUT.elements.status);
    expect(r.elements.minimap).toEqual(el());
    expect(changed.elements.status).toEqual(el()); // input untouched
    const v = resetElement(resolveLayout({ version: 1, elements: { weapon: el() } }), 'vehicle');
    expect(v.elements.weapon).toEqual(DEFAULT_HUD_LAYOUT.elements.weapon);
    const all = resetAll();
    expect(all).toEqual(DEFAULT_HUD_LAYOUT);
    all.elements.status.scale = 1.4; // a copy: defaults stay intact
    expect(DEFAULT_HUD_LAYOUT.elements.status.scale).toBe(1);
  });
});

describe('clampToViewport', () => {
  const viewports = [
    { w: 1280, h: 720 },
    { w: 1920, h: 1080 },
    { w: 3840, h: 2160 },
  ];
  const size = { w: 226, h: 48 };

  it('places defaults at their 1280×720 px offsets', () => {
    const hotbar = clampToViewport(DEFAULT_HUD_LAYOUT.elements.hotbar, viewports[0]!, size);
    expect(hotbar.left).toBeCloseTo(1280 - 18 - 226);
    expect(hotbar.top).toBeCloseTo(720 - 18 - 48);
    const mm = clampToViewport(DEFAULT_HUD_LAYOUT.elements.minimap, viewports[0]!, {
      w: 136,
      h: 136,
    });
    expect(mm.left).toBeCloseTo(1280 - 18 - 136);
    expect(mm.top).toBeCloseTo(47);
    const threat = clampToViewport(DEFAULT_HUD_LAYOUT.elements.threat, viewports[0]!, {
      w: 200,
      h: 30,
    });
    expect(threat.left).toBeCloseTo(540);
  });

  it('never leaves the screen (all anchors, extremes, scale 1.5)', () => {
    const anchors = ['tl', 'tc', 'tr', 'cl', 'cr', 'bl', 'bc', 'br'] as const;
    for (const vp of viewports) {
      for (const anchor of anchors) {
        for (const off of [-0.5, 0, 0.5, 1]) {
          for (const scale of [0.5, 1, 1.5]) {
            const r = clampToViewport(el({ anchor, x: off, y: off, scale }), vp, size);
            expect(r.width).toBeCloseTo(size.w * scale);
            expect(r.height).toBeCloseTo(size.h * scale);
            expect(r.left).toBeGreaterThanOrEqual(0);
            expect(r.top).toBeGreaterThanOrEqual(0);
            expect(r.left + r.width).toBeLessThanOrEqual(vp.w + 1e-9);
            expect(r.top + r.height).toBeLessThanOrEqual(vp.h + 1e-9);
          }
        }
      }
    }
  });

  it('scale 1.5 at bottom-right stays on screen at 1280×720', () => {
    const r = clampToViewport(el({ anchor: 'br', x: 0, y: 0, scale: 1.5 }), viewports[0]!, size);
    expect(r.left).toBeCloseTo(1280 - 339);
    expect(r.top).toBeCloseTo(720 - 72);
  });

  it('multiplies by uiScale: 1.25 × 1.5 at 1280×720 stays on screen', () => {
    const vp = viewports[0]!;
    for (const anchor of ['tl', 'tc', 'tr', 'cl', 'cr', 'bl', 'bc', 'br'] as const) {
      for (const off of [-0.5, 0, 0.5, 1]) {
        const r = clampToViewport(el({ anchor, x: off, y: off, scale: 1.5 }), vp, size, 1.25);
        expect(r.width).toBeCloseTo(226 * 1.875);
        expect(r.height).toBeCloseTo(48 * 1.875);
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.top).toBeGreaterThanOrEqual(0);
        expect(r.left + r.width).toBeLessThanOrEqual(vp.w + 1e-9);
        expect(r.top + r.height).toBeLessThanOrEqual(vp.h + 1e-9);
      }
    }
    const br = clampToViewport(el({ anchor: 'br', x: 0, y: 0, scale: 1.5 }), vp, size, 1.25);
    expect(br.left).toBeCloseTo(1280 - 226 * 1.875);
    expect(br.top).toBeCloseTo(720 - 48 * 1.875);
    // Invalid uiScale → 1.
    expect(clampToViewport(el(), vp, size, Number.NaN).width).toBeCloseTo(226);
  });

  it('pins an element larger than the screen to the top-left', () => {
    const r = clampToViewport(
      el({ anchor: 'br', scale: 1.5 }),
      { w: 300, h: 200 },
      {
        w: 400,
        h: 400,
      },
    );
    expect(r).toMatchObject({ left: 0, top: 0, width: 600, height: 600 });
  });
});
