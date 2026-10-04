// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createVehicleHud } from './vehicle-hud.js';

describe('vehicle HUD', () => {
  it('starts with every part hidden, so nothing covers the game canvas outside a car', () => {
    const hud = createVehicleHud();
    const parts = [...hud.el.children] as HTMLElement[];
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) expect(p.hidden, p.className).toBe(true);
    // The repair modal fills the screen with pointer-events: auto; hidden is what lets clicks and
    // the wheel through to the canvas (attack, zoom, Shift-click zombie HP).
    expect(hud.el.querySelector<HTMLElement>('.dz-vh__modal')?.hidden).toBe(true);
  });

  it('an empty update keeps the parts hidden', () => {
    const hud = createVehicleHud();
    hud.update({});
    for (const p of [...hud.el.children] as HTMLElement[]) expect(p.hidden, p.className).toBe(true);
  });
});
