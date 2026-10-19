import { describe, expect, it } from 'vitest';
import { furnitureMenuVM } from './furniture-model.js';
import { menuHtml } from './furniture-views.js';
import { tankLitres, waterTankLine } from './water-tank.js';
import type { FurnitureView } from './furniture-api.js';
import type { GameState } from '../../state/game-state.js';
import type { HudContentIndex } from '../content-index.js';

describe('water tank line (FurnitureView.waterTank, protocol 36)', () => {
  it('formats litres: whole litres, one decimal below 1 l', () => {
    expect(tankLitres(7.4)).toBe('7');
    expect(tankLitres(9.6)).toBe('10');
    expect(tankLitres(0)).toBe('0');
    expect(tankLitres(0.44)).toBe('0,4');
    expect(tankLitres(0.97)).toBe('1');
    expect(tankLitres(-0.2)).toBe('0');
  });

  it('names the quality in Polish', () => {
    expect(waterTankLine({ litres: 7, capacityL: 10, quality: 'tainted' })).toBe(
      'Woda: 7/10 l, brudna',
    );
    expect(waterTankLine({ litres: 0.5, capacityL: 10, quality: 'clean' })).toBe(
      'Woda: 0,5/10 l, czysta',
    );
  });

  it('shows the line in the menu; an empty tank greys the sim actions with the sim text', () => {
    const view: FurnitureView = {
      furnitureId: 1,
      typeId: 'toilet',
      contentId: 'base:toilet',
      x: 0,
      y: 0,
      z: 0,
      waterTank: { litres: 0, capacityL: 10, quality: 'tainted' },
      actions: [
        {
          id: 'drink-tank',
          labelPl: 'Napij się ze zbiornika',
          enabled: false,
          reason: 'no-water',
          reasonPl: 'Pusty zbiornik',
        },
        {
          id: 'fill-water',
          labelPl: 'Napełnij butelkę',
          enabled: false,
          reason: 'no-water',
          reasonPl: 'Pusty zbiornik',
        },
      ],
    };
    const ctx = {
      state: { player: { stats: {} } } as unknown as GameState,
      content: {} as HudContentIndex,
    };
    const vm = furnitureMenuVM(view, ctx);
    expect(vm.tank).toBe('Woda: 0/10 l, brudna');
    expect(vm.rows.map((r) => [r.label, r.enabled, r.right])).toEqual([
      ['Napij się ze zbiornika', false, 'Pusty zbiornik'],
      ['Napełnij butelkę', false, 'Pusty zbiornik'],
    ]);
    expect(vm.rows[0]!.reasonIcon).toBe('water');
    expect(vm.pills.map((p) => p.text)).not.toContain('BRAK WODY');
    const html = menuHtml(vm, -1, { run: 'F', close: 'Esc' });
    expect(html).toContain('Woda: 0/10 l, brudna');
    expect(html).toContain('data-off="true"');
  });

  it('a full tank with mains off is not „BRAK WODY”', () => {
    const view: FurnitureView = {
      furnitureId: 1,
      typeId: 'toilet',
      contentId: 'base:toilet',
      x: 0,
      y: 0,
      z: 0,
      waterTank: { litres: 10, capacityL: 10, quality: 'tainted' },
      actions: [{ id: 'drink-tank', labelPl: 'Napij się ze zbiornika', enabled: true }],
    };
    const vm = furnitureMenuVM(view, {
      state: { player: { stats: {} } } as unknown as GameState,
      content: {} as HudContentIndex,
      utilities: { power: true, water: false } as never,
    });
    expect(vm.pills.map((p) => p.text)).not.toContain('BRAK WODY');
    expect(vm.tank).toBe('Woda: 10/10 l, brudna');
  });

  it('a tap with the mains cut still shows „BRAK WODY”', () => {
    const view: FurnitureView = {
      furnitureId: 2,
      typeId: 'sink',
      contentId: 'base:sink',
      x: 0,
      y: 0,
      z: 0,
      actions: [
        {
          id: 'fill-water',
          labelPl: 'Napełnij butelkę',
          enabled: false,
          reason: 'no-water',
          reasonPl: 'Brak wody',
        },
      ],
    };
    const vm = furnitureMenuVM(view, {
      state: { player: { stats: {} } } as unknown as GameState,
      content: {} as HudContentIndex,
      utilities: { power: true, water: false } as never,
    });
    expect(vm.pills.map((p) => p.text)).toContain('BRAK WODY');
  });
});
