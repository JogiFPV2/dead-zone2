import { describe, expect, it } from 'vitest';
import {
  GAP_PX,
  anchorForRect,
  changedLabel,
  layoutFromRect,
  offsetsForRect,
  placeRect,
  positionText,
  snapRect,
  snapScale,
  type Rect,
} from './hud-layout-model.js';

const vp = { w: 1280, h: 720 };
const base = { scale: 1, opacity: 1, visible: true };

describe('HUD layout model', () => {
  it('picks the anchor from the screen third of the centre', () => {
    expect(anchorForRect({ left: 18, top: 18, width: 100, height: 50 }, vp)).toBe('tl');
    expect(anchorForRect({ left: 600, top: 650, width: 80, height: 50 }, vp)).toBe('bc');
    expect(anchorForRect({ left: 1100, top: 650, width: 100, height: 50 }, vp)).toBe('br');
    expect(anchorForRect({ left: 1100, top: 330, width: 100, height: 50 }, vp)).toBe('cr');
    // Middle cell: nearest edge.
    expect(anchorForRect({ left: 500, top: 250, width: 100, height: 50 }, vp)).toBe('tc');
  });

  it('round-trips a rect through offsets and placement for every anchor', () => {
    const r: Rect = { left: 300, top: 400, width: 200, height: 60 };
    for (const anchor of ['tl', 'tc', 'tr', 'cl', 'cr', 'bl', 'bc', 'br'] as const) {
      const el = layoutFromRect(r, vp, base, anchor);
      const { rect } = placeRect(el, vp, { w: 200, h: 60 });
      expect(rect.left).toBeCloseTo(300, 0);
      expect(rect.top).toBeCloseTo(400, 0);
    }
  });

  it('spec example: the minimap at the left edge under the statuses', () => {
    const el = layoutFromRect({ left: 18, top: 153, width: 136, height: 136 }, vp, base);
    expect(el.anchor).toBe('tl');
    expect(el.x * 100).toBeCloseTo(1.4, 1);
    expect(el.y * 100).toBeCloseTo(21.25, 1);
    expect(positionText(el)).toMatchObject({ x: '1,4%', xs: 'od lewej', ys: 'od góry' });
  });

  it('keeps every element on screen at any resolution, shrinking it only for now', () => {
    const el = { anchor: 'br' as const, x: 0.9, y: 0.9, scale: 1.5, opacity: 1, visible: true };
    for (const v of [
      { w: 1024, h: 768 },
      { w: 1920, h: 1080 },
      { w: 640, h: 360 },
    ]) {
      const { rect, k } = placeRect(el, v, { w: 500, h: 300 });
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.left + rect.width).toBeLessThanOrEqual(v.w + 1e-6);
      expect(rect.top + rect.height).toBeLessThanOrEqual(v.h + 1e-6);
      expect(k).toBeLessThanOrEqual(1.5);
    }
    expect(placeRect(el, { w: 640, h: 360 }, { w: 500, h: 300 }).k).toBeCloseTo(1.08, 2);
    expect(el.scale).toBe(1.5);
  });

  it('snaps to the safe edge first, then the centre, other elements (12 px gap), the grid', () => {
    const r: Rect = { left: 22, top: 300, width: 100, height: 40 };
    expect(snapRect(r, [], vp, { snap: true, grid: true }).left).toBe(18);
    const c = snapRect({ ...r, left: 585 }, [], vp, { snap: true, grid: true });
    expect(c.left).toBe(590);
    expect(c.guides.some((g) => g.kind === 'center')).toBe(true);
    const other = {
      slot: 'status' as const,
      rect: { left: 400, top: 100, width: 205, height: 100 },
    };
    const g = snapRect({ left: 400, top: 214, width: 136, height: 136 }, [other], vp, {
      snap: true,
      grid: false,
    });
    expect(g.top).toBe(200 + GAP_PX);
    expect(g.labels.join()).toContain('odstęp 12 px · Statusy');
    expect(snapRect({ ...r, left: 245 }, [], vp, { snap: true, grid: true }).left).toBe(240);
    expect(snapRect({ ...r, left: 245 }, [], vp, { snap: false, grid: true }).left).toBe(245);
  });

  it('clamps a drag past the screen even without snapping', () => {
    const s = snapRect({ left: 1250, top: -40, width: 100, height: 40 }, [], vp, {
      snap: false,
      grid: false,
    });
    expect(s).toMatchObject({ left: 1180, top: 0 });
  });

  it('formats counts and steps', () => {
    expect([1, 2, 4, 5, 12, 22].map(changedLabel)).toEqual([
      '1 zmieniony element',
      '2 zmienione elementy',
      '4 zmienione elementy',
      '5 zmienionych elementów',
      '12 zmienionych elementów',
      '22 zmienione elementy',
    ]);
    expect([0.1, 0.72, 1.53].map(snapScale)).toEqual([0.5, 0.7, 1.5]);
    expect(offsetsForRect({ left: 0, top: 0, width: 10, height: 10 }, 'tl', vp)).toEqual({
      x: 0,
      y: 0,
    });
  });
});
