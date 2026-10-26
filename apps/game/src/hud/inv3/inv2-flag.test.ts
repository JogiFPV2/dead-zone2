import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inventoryV2Enabled } from './inv2-flag.js';

const css = readFileSync(new URL('./inventory-v2-mobile.css', import.meta.url), 'utf8');

describe('inventory v2 flag', () => {
  it('is off by default and on only with ?inv=v2', () => {
    expect(inventoryV2Enabled('')).toBe(false);
    expect(inventoryV2Enabled('?touch=1')).toBe(false);
    expect(inventoryV2Enabled('?inv=v3')).toBe(false);
    expect(inventoryV2Enabled('?touch=1&inv=v2')).toBe(true);
  });
  it('every rule is scoped to touch + the flag (desktop and default untouched)', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((r) => r.split('{')[0]!.trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors)
      for (const part of s.split(',')) expect(part.trim()).toMatch(/^html\.is-touch\.dz-inv2 /);
  });
  it('spec sizes: rail 52, backpack 398, surroundings 310, cells 50, buttons 44, menu 210 × 44', () => {
    for (const v of ['width: 52px', 'width: min(398px', 'width: 310px', 'width: 50px', 'height: 44px', 'width: 210px'])
      expect(css).toContain(v);
  });
});
