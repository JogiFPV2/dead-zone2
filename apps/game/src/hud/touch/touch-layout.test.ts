import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOUCH_MAP_FULL, TOUCH_MINIMAP, TOUCH_MOVE_TOP } from './touch-layout.js';

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
