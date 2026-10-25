// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { scanBuilding } from '../floors/building-plan.js';
import { testBuildingSource } from '../floors/test-building.js';
import { createFloorHud, edgePaths, stairsPath, type FloorHudVM } from './floor-hud.js';

const plan = scanBuilding(testBuildingSource(), 7, 30, 4, 0)!;
const vm = (z: number, extra: Partial<FloorHudVM> = {}): FloorHudVM => ({
  inside: true,
  z,
  zMin: plan.zMin,
  zMax: plan.zMax,
  building: 7,
  plan: plan.floors.get(z),
  zombies: [],
  ...extra,
});

function setup() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.append(world);
  return { world, hud: createFloorHud(world) };
}

describe('floor badge', () => {
  it('hidden outside, name and arrows inside', () => {
    const { hud } = setup();
    hud.update({ inside: false, z: 0, zMin: 0, zMax: 0, zombies: [] }, 0, 2.5);
    expect(hud.badge.hidden).toBe(true);
    hud.update(vm(0), 10, 2.5);
    expect(hud.badge.hidden).toBe(false);
    expect(hud.badge.querySelector('.dz-floor__name')!.textContent).toBe('PARTER');
    expect(hud.badge.querySelector('.dz-floor__up')!.classList.contains('off')).toBe(false);
    expect(hud.badge.querySelector('.dz-floor__down')!.classList.contains('off')).toBe(true);
    // Arrows are SVG (the game font has no ↑↓).
    expect(hud.badge.querySelectorAll('svg')).toHaveLength(2);
  });

  it('level change: accent + slide, toast with the new floor', () => {
    const { hud } = setup();
    hud.update(vm(0), 0, 2.5);
    hud.update(vm(1), 100, 2.5);
    expect(hud.badge.classList.contains('dz-floor--change')).toBe(true);
    expect(hud.badge.dataset.change).toBe('up');
    expect(hud.badge.querySelector('.dz-floor__prev')!.textContent).toBe('PARTER');
    expect(hud.toast.hidden).toBe(false);
    expect(hud.toast.textContent).toBe('1 PIĘTRO');
    hud.update(vm(1), 800, 2.5);
    expect(hud.badge.classList.contains('dz-floor--change')).toBe(false);
  });

  it('HUD editor preview shows a sample badge outside buildings', () => {
    const { hud } = setup();
    hud.update({ inside: false, z: 0, zMin: 0, zMax: 0, zombies: [] }, 0, 2.5);
    hud.setEditPreview(true);
    expect(hud.badge.hidden).toBe(false);
    expect(hud.badge.textContent).toContain('1 PIĘTRO');
    hud.setEditPreview(false);
    expect(hud.badge.hidden).toBe(true);
  });
});

describe('minimap in a building', () => {
  it('draws the current floor and only ±1 floor zombies, dimmed with ▲▼', () => {
    const { world, hud } = setup();
    hud.update(
      vm(0, {
        zombies: [
          { x: 30, y: 4, z: 0 },
          { x: 31, y: 4, z: 1 },
          { x: 31, y: 4, z: 3 },
        ],
      }),
      0,
      2.5,
    );
    expect(world.querySelector('.dz-mmfloor__plan')).not.toBeNull();
    expect(world.querySelectorAll('.dz-mmfloor__zombies > *')).toHaveLength(2);
    expect(world.querySelectorAll('.dz-mmfloor__z--other')).toHaveLength(1);
    expect(world.querySelector('.dz-mmfloor__tri')).not.toBeNull();
  });

  it('sensed zombies one floor up / down: dimmed SVG dots with ▲ / ▼ path, not text', () => {
    const { world, hud } = setup();
    hud.update(
      vm(1, {
        zombies: [
          { x: 30, y: 4, z: 2 },
          { x: 30, y: 6, z: 0 },
        ],
      }),
      0,
      2.5,
    );
    const others = [...world.querySelectorAll('.dz-mmfloor__z--other')];
    expect(others).toHaveLength(2);
    const tri = others.map((g) => g.querySelector('path.dz-mmfloor__tri')!.getAttribute('d')!);
    // ▲ (apex up: second leg goes up, −y) above, ▼ (apex down) below.
    expect(tri[0]).toMatch(/l[\d.]+ -[\d.]+l/);
    expect(tri[1]).not.toMatch(/l[\d.]+ -[\d.]+l/);
    expect(others.every((g) => g.querySelector('circle') && !g.textContent)).toBe(true);
  });

  it('wall paths skip doors; stairs get treads', () => {
    const f0 = plan.floors.get(0)!;
    const e = edgePaths(f0);
    expect(e.windows).toBe('M30 2L31 2');
    expect(e.outer).not.toContain('M33 8L34 8');
    expect(e.inner).toContain('M32 2L32 3');
    const s = stairsPath(f0);
    expect(s.box).toBe('M30 3H31V6H30z');
    expect(s.treads.split('M').length - 1).toBe(5);
  });
});
