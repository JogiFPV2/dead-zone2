// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { scanBuilding } from '../floors/building-plan.js';
import { DemoFloorIntel, SimFloorIntel } from '../floors/floor-intel.js';
import { testBuildingSource } from '../floors/test-building.js';
import { fogChunk, fogGrid, setDiscovered, type Marker } from './bigmap-model.js';
import { createFloorPanel, floorClick, pickDiscovered, planSvg } from './floor-panel.js';

const plan = scanBuilding(testBuildingSource(), 7, 30, 4, 0)!;
const marker: Marker = {
  id: 3,
  x: 33,
  y: 3,
  icon: 'base:marker-food',
  color: 'blue',
  text: 'Leki w szafce',
  showOnMinimap: true,
};

function setup(intel = new SimFloorIntel() as SimFloorIntel | DemoFloorIntel, z?: number) {
  let closed = 0;
  const panel = createFloorPanel({
    floors: {
      intel,
      pick: () => plan,
      current: () => (z === undefined ? undefined : { plan, z }),
    },
    markers: () => [marker],
    tick: () => 20 * 3600 * 3,
    location: () => 'Stalowa Wola',
    onClose: () => closed++,
  });
  return { panel, closed: () => closed };
}

describe('floor panel', () => {
  it('opens on the player floor in that building, PgUp / PgDn step within the levels', () => {
    const { panel } = setup(new SimFloorIntel(), 1);
    panel.open(plan);
    panel.frame({ center: { x: 32, y: 5 }, zoom: 2 }, { width: 1280, height: 720 });
    expect(panel.el.querySelector('.dz-fp__row.sel b')!.textContent).toBe('1');
    expect(panel.el.textContent).toContain('RZUT · 1 PIĘTRO');
    panel.step(1);
    panel.frame({ center: { x: 32, y: 5 }, zoom: 2 }, { width: 1280, height: 720 });
    expect(panel.el.querySelector('.dz-fp__row.sel b')!.textContent).toBe('1');
    panel.step(-1);
    panel.frame({ center: { x: 32, y: 5 }, zoom: 2 }, { width: 1280, height: 720 });
    expect(panel.el.querySelector('.dz-fp__row.sel b')!.textContent).toBe('P');
  });

  it('header chips, stats, marker on the ground floor (no z yet), legend', () => {
    const { panel, closed } = setup();
    panel.open(plan);
    panel.frame({ center: { x: 32, y: 5 }, zoom: 2 }, { width: 1280, height: 720 });
    const t = panel.el.textContent;
    expect(t).toContain('DOM');
    expect(t).toContain('2 KONDYGNACJE · P + 1 PIĘTRO');
    expect(t).toContain('1 KLATKA');
    expect(t).toContain('pomieszczenia: 3');
    expect(t).toContain('nieodkryte: 3');
    expect(t).toContain('Leki w szafce');
    expect(t).toContain('LEGENDA');
    expect(panel.el.querySelectorAll('.dz-fp__pin')).toHaveLength(1);
    expect(panel.overlay.querySelector('.dz-fp-ov__tag')!.textContent).toBe('DOM · P+1');
    panel.close();
    expect(panel.isOpen).toBe(false);
    expect(closed()).toBe(1);
  });

  it('demo intel: zombies on the plan with their age', () => {
    const intel = new DemoFloorIntel();
    intel.setup(plan, { x: 30, y: 4, z: 0 }, 20 * 3600 * 3);
    const { panel } = setup(intel);
    panel.open(plan, 0);
    panel.frame({ center: { x: 32, y: 5 }, zoom: 2 }, { width: 1280, height: 720 });
    expect(panel.el.querySelectorAll('.dz-fp__zp').length).toBeGreaterThan(0);
    expect(panel.el.textContent).toContain('zombie');
  });

  it('plan svg: fog hatch for unknown rooms, stairs letter', () => {
    const svg = planSvg(plan, plan.floors.get(0)!, new SimFloorIntel(), 10).svg;
    expect(svg).toContain('url(#dzfp-fog)');
    expect(svg).toContain('>A</text>');
  });
});

describe('pickDiscovered (LPM on the big map)', () => {
  const picks: { x: number; y: number }[] = [];
  const floors = {
    pick: (x: number, y: number) => {
      picks.push({ x, y });
      return plan;
    },
  };
  const bounds = { cx0: 0, cy0: 0, cx1: 3, cy1: 3 };

  it('in the fog a building is not picked (no panel, no pointer cursor)', () => {
    picks.length = 0;
    expect(pickDiscovered(floors, fogGrid(bounds), 30, 4)).toBeUndefined();
    expect(picks).toEqual([]);
  });

  it('in a discovered chunk the building under the point is picked', () => {
    picks.length = 0;
    const fog = fogGrid(bounds);
    const c = fogChunk(30, 4);
    setDiscovered(fog, c.cx, c.cy);
    expect(pickDiscovered(floors, fog, 30, 4)).toBe(plan);
    expect(picks).toEqual([{ x: 30, y: 4 }]);
  });

  it('decides by the chunk under the point: the fogged part of a building does nothing', () => {
    const fog = fogGrid(bounds);
    const a = fogChunk(30, 4);
    const b = fogChunk(33, 4);
    expect(b.cx).not.toBe(a.cx); // the fixture building crosses the chunk border
    setDiscovered(fog, a.cx, a.cy);
    expect(pickDiscovered(floors, fog, 33, 4)).toBeUndefined();
    expect(pickDiscovered(floors, fog, -5, 4)).toBeUndefined(); // outside the fog bounds
  });
});

describe('floorClick (LPM on the big map)', () => {
  const bounds = { cx0: 0, cy0: 0, cx1: 3, cy1: 3 };
  const discovered = () => {
    const fog = fogGrid(bounds);
    const c = fogChunk(30, 4);
    setDiscovered(fog, c.cx, c.cy);
    return fog;
  };

  it('a building in the discovered part opens its panel', () => {
    expect(floorClick({ pick: () => plan }, discovered(), 30, 4)).toEqual({ open: plan });
  });

  it('empty discovered ground closes the panel', () => {
    expect(floorClick({ pick: () => undefined }, discovered(), 30, 4)).toBe('close');
  });

  it('a click in the fog does nothing (does not open, does not close, does not pick)', () => {
    let picked = 0;
    const floors = {
      pick: () => {
        picked++;
        return plan;
      },
    };
    expect(floorClick(floors, fogGrid(bounds), 30, 4)).toBe('none');
    expect(floorClick(floors, discovered(), 33, 4)).toBe('none');
    expect(picked).toBe(0);
  });
});

describe('floor rows with sim data', () => {
  it('an unvisited floor shows zombies heard there instead of „—”', () => {
    const intel = new SimFloorIntel();
    intel.applyView({ worldMap: { zombieSightings: [{ x: 30, y: 4, z: 1, tick: 10 }] } });
    const { panel } = setup(intel);
    panel.open(plan);
    panel.frame({ center: { x: 32, y: 5 }, zoom: 2 }, { width: 1280, height: 720 });
    const row = (z: number) => panel.el.querySelector(`.dz-fp__row[data-z="${z}"]`)!;
    expect(row(1).querySelector('.dz-fp__zd')).not.toBeNull();
    expect(row(1).querySelector('.dz-fp__none')).toBeNull();
    // The fixture marker (no floor from the sim) counts on the ground floor.
    expect(row(0).querySelector('.dz-fp__none')).toBeNull();
  });
});
