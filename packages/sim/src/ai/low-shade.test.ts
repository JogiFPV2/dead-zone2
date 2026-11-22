import { describe, expect, it } from 'vitest';
import { aiSim } from '../test/ai-fixtures.js';
import { buildMap, type MapSpec } from '../test/fixtures.js';
import { vehicleSim } from '../test/vehicle-fixtures.js';
import { TileGrid } from '../world/grid.js';
import { LIGHT, lightLevelAt } from './light.js';
import { sunState } from './sky.js';

const sun = sunState(12 * 60);
/** Ground distance (m) behind a caster of height `h` where a body at `body` is still shaded. */
const reach = (h: number, body: number) => (h - body) / sun.tanEl;

describe('low shade: cars, fences and walls (docs 9.45)', () => {
  it('noon sun is south and high enough that a standing body is above a 1.5 m fence a step away', () => {
    expect(sun.up).toBe(true);
    expect(sun.hy).toBeGreaterThan(0.99);
    expect(reach(LIGHT.fenceHeightM, LIGHT.sneakBodyHeightM)).toBeGreaterThan(0.3);
  });

  // A fence along y = 20 (north edges of row 20), x ∈ [5, 25).
  const fenced: MapSpec = {
    width: 64,
    height: 64,
    wallN: (x, y) => y === 20 && x >= 5 && x < 25,
    edgeId: () => 2,
    edgeKinds: [null, 'wall', 'fence'],
  };

  it('sneaking right north of a fence (sun in the south) is in its shadow; standing far is not', () => {
    const sim = aiSim({ map: fenced, spawn: { x: 10.5, y: 19.8 } });
    const grid = new TileGrid(buildMap(fenced));
    sim.step();
    const w = sim.world;
    const at = (y: number, body: number) => lightLevelAt(w, w.ai!, grid, 10.5, y, 0, body);
    const d = Math.min(0.9, reach(LIGHT.fenceHeightM, LIGHT.sneakBodyHeightM) * 0.8);
    expect(at(20 - d, LIGHT.sneakBodyHeightM)).toBeCloseTo(LIGHT.lowShadeMul, 5);
    expect(at(20 - 6, LIGHT.sneakBodyHeightM)).toBe(1);
    // South of the fence (sun side): lit.
    expect(at(20.5, LIGHT.sneakBodyHeightM)).toBe(1);
    // Garden wall (edge kind wall) also casts it.
    const walled = { ...fenced, edgeId: () => 1 };
    const g2 = new TileGrid(buildMap(walled));
    expect(lightLevelAt(w, w.ai!, g2, 10.5, 20 - d, 0, LIGHT.sneakBodyHeightM)).toBeCloseTo(
      LIGHT.lowShadeMul,
      5,
    );
  });

  it('crouching right north of a car is in its shadow; far from it is lit', () => {
    const sim = vehicleSim({ car: { x: 20, y: 64 } });
    sim.step();
    const w = sim.world;
    const grid = new TileGrid(buildMap({ width: 256, height: 128 }));
    // Sedan heading +x: half width 0.9 m, so its north side is at y ≈ 63.1.
    const d = Math.min(0.8, reach(LIGHT.carHeightM, LIGHT.sneakBodyHeightM) * 0.6);
    const lit = (x: number, y: number) =>
      lightLevelAt(w, w.ai!, grid, x, y, 0, LIGHT.sneakBodyHeightM);
    expect(lit(20, 63.1 - d)).toBeCloseTo(LIGHT.lowShadeMul, 5);
    expect(lit(20, 55)).toBe(1);
    expect(lit(60, 63.1 - d)).toBe(1);
  });
});
