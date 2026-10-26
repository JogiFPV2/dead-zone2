import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOUCH_BUTTONS } from './touch-hud.js';
import {
  TOUCH_CENTER_FREE,
  TOUCH_MAP_FULL,
  TOUCH_MINIMAP,
  TOUCH_MOVE_TOP,
  TOUCH_SAFE_MIN,
  TOUCH_ZOOM,
} from './touch-layout.js';

const css = readFileSync(new URL('./touch.css', import.meta.url), 'utf8');

describe('touch layout: minimap', () => {
  it('shows the minimap on touch (not in the hidden list)', () => {
    const hidden = css.slice(css.indexOf('html.is-touch .dz-topbar'), css.indexOf('display: none'));
    expect(hidden).not.toContain('dz-g--minimap');
    expect(css).toContain(`left: calc(${TOUCH_MINIMAP.left}px + var(--dz-safe-l))`);
    expect(css).toContain(`top: calc(${TOUCH_MINIMAP.top}px + var(--dz-safe-t))`);
    expect(css).toContain(`width: ${TOUCH_MINIMAP.size}px`);
  });
  it('keeps the joystick zone below the minimap and the full-map button', () => {
    expect(TOUCH_MOVE_TOP).toBeGreaterThan(TOUCH_MINIMAP.top + TOUCH_MINIMAP.size);
    expect(TOUCH_MOVE_TOP).toBeGreaterThan(TOUCH_MAP_FULL.top + TOUCH_MAP_FULL.size);
    expect(css).toContain(`top: calc(${TOUCH_MOVE_TOP}px + var(--dz-safe-t))`);
  });
  it('full-map button is finger sized and right of the minimap', () => {
    expect(TOUCH_MAP_FULL.size).toBeGreaterThanOrEqual(44);
    expect(TOUCH_MAP_FULL.left).toBeGreaterThan(TOUCH_MINIMAP.left + TOUCH_MINIMAP.size);
  });
});

describe('touch layout: zoom slider', () => {
  it('stays above every thumb button (CEL/AKCJA/BIEG/SKRAD/ATAK) it shares a column with', () => {
    for (const b of TOUCH_BUTTONS) {
      const overlapsX =
        b.right < TOUCH_ZOOM.right + TOUCH_ZOOM.width && b.right + b.size > TOUCH_ZOOM.right;
      if (overlapsX) expect(b.bottom + b.size).toBeLessThan(TOUCH_ZOOM.bottom);
    }
  });
  it('leaves a usable track on an 844×390 phone and clears the 50 px top bar', () => {
    expect(390 - TOUCH_ZOOM.top - TOUCH_ZOOM.bottom).toBeGreaterThanOrEqual(120);
    expect(TOUCH_ZOOM.top).toBeGreaterThanOrEqual(56);
    expect(css).toContain(`bottom: calc(${TOUCH_ZOOM.bottom}px + var(--dz-safe-b))`);
  });
});

describe('touch layout: full map', () => {
  it('moves the map bar right of the ZAMKNIJ pill', () => {
    expect(css).toMatch(/html\.is-touch \.dz-bm__bar \{\s*padding-left: calc\(140px/);
  });
});

describe('touch layout: mobile HUD spec', () => {
  it('safe-area floors give 47 L/R, 8 top, 21 bottom with the 8 / 6 / 18 px offsets', () => {
    expect(8 + TOUCH_SAFE_MIN.l).toBe(47);
    expect(8 + TOUCH_SAFE_MIN.r).toBe(47);
    expect(6 + TOUCH_SAFE_MIN.t).toBe(8);
    expect(18 + TOUCH_SAFE_MIN.b).toBe(21);
    expect(css).toContain(`--dz-safe-l: max(${TOUCH_SAFE_MIN.l}px`);
    expect(css).toContain(`--dz-safe-b: max(${TOUCH_SAFE_MIN.b}px`);
  });
  it('minimap at screen (47, 28), 96×96', () => {
    expect(TOUCH_MINIMAP.left + TOUCH_SAFE_MIN.l).toBe(47);
    expect(TOUCH_MINIMAP.top + TOUCH_SAFE_MIN.t).toBe(28);
    expect(TOUCH_MINIMAP.size).toBe(96);
  });
  it('zoom slider spans screen y 62–186 on 844×390', () => {
    expect(TOUCH_ZOOM.top + TOUCH_SAFE_MIN.t).toBe(62);
    expect(390 - TOUCH_ZOOM.bottom - TOUCH_SAFE_MIN.b).toBe(186);
  });
  it('no thumb button in the free centre rectangle (40–60 % × 30–75 %)', () => {
    const W = 844;
    const H = 390;
    for (const b of TOUCH_BUTTONS) {
      const x0 = W - (b.right + TOUCH_SAFE_MIN.r) - b.size;
      const y1 = H - (b.bottom + TOUCH_SAFE_MIN.b);
      const y0 = y1 - b.size;
      const inX = x0 < W * TOUCH_CENTER_FREE.x1 && x0 + b.size > W * TOUCH_CENTER_FREE.x0;
      const inY = y0 < H * TOUCH_CENTER_FREE.y1 && y1 > H * TOUCH_CENTER_FREE.y0;
      expect(inX && inY, b.id).toBe(false);
    }
  });
});
