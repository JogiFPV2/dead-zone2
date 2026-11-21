import { STEALTH_DIM_MAX, STEALTH_HIDDEN_MAX, type SimViewPatch } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { ClockStart } from '../core/clock.js';
import type { Sim } from '../sim.js';
import { aiSim, MIDNIGHT, NOON } from '../test/ai-fixtures.js';
import { send } from '../test/content-fixtures.js';
import { buildMap, type MapSpec } from '../test/fixtures.js';
import { TileGrid } from '../world/grid.js';
import { DEFAULT_STAGE4_CONFIG } from './config.js';
import { LIGHT, lightLevelAt, playerVisibility, stealthOf } from './light.js';
import { sightFactor, sunState } from './sky.js';

const VC = DEFAULT_STAGE4_CONFIG.vision;
/** Building y ∈ [30, 40), x ∈ [20, 40), 2 levels (6 m), rooms; everything else open ground. */
const town: MapSpec = {
  width: 64,
  height: 64,
  levels: 2,
  room: (x, y) => (x >= 20 && x < 40 && y >= 30 && y < 40 ? 1 : 0),
  rooms: { '1': 'base:room-kitchen' },
};

const grids = new WeakMap<Sim, TileGrid>();

function at(clock: ClockStart, spawn: { x: number; y: number }, map: MapSpec = town): Sim {
  const sim = aiSim({ map, spawn, clock });
  grids.set(sim, new TileGrid(buildMap(map)));
  sim.step();
  return sim;
}

function light(sim: Sim, x?: number, y?: number): number {
  const w = sim.world;
  const p = sim.getPlayer()!;
  return lightLevelAt(w, w.ai!, grids.get(sim)!, x ?? p.x, y ?? p.y, 0);
}

const vis = (sim: Sim) => playerVisibility(sim.world, sim.world.ai!, sim.world.players.get(0)!);

describe('light: sun, sky and shadows (one model with the renderer: sunAt)', () => {
  it('sky: 1 at noon, moonlight at midnight; sight factor = nightFactor under the moon', () => {
    const noon = sunState(12 * 60);
    expect(noon.sky).toBe(1);
    expect(noon.up).toBe(true);
    // Noon: the sun is due south (sim +y).
    expect(noon.hy).toBeGreaterThan(0.99);
    const night = sunState(24 * 60);
    expect(night.sky).toBeCloseTo(LIGHT.moon, 6);
    expect(night.up).toBe(false);
    expect(sightFactor(VC, night.sky)).toBeCloseTo(VC.nightFactor, 6);
    expect(sightFactor(VC, 1)).toBe(1);
  });

  it('a 2-level building casts a shadow to the north at noon, not far away', () => {
    const sim = at(NOON, { x: 30.5, y: 28.5 });
    expect(light(sim)).toBeCloseTo(LIGHT.shadowMul, 5);
    expect(light(sim, 30.5, 20.5)).toBe(1);
    // South of the building: sunlit.
    expect(light(sim, 30.5, 41.5)).toBe(1);
  });

  it('indoors darker, dark zone black, a lamp lights the night', () => {
    const sim = at(NOON, { x: 30.5, y: 35.5 });
    expect(light(sim)).toBeCloseTo(LIGHT.indoorMul, 5);
    const dark = at(
      NOON,
      { x: 10.5, y: 10.5 },
      {
        ...town,
        zones: [{ id: 'cellar', role: 'dark', z: 0, rects: [{ x: 0, y: 0, w: 16, h: 16 }] }],
      },
    );
    expect(light(dark)).toBe(0);
    const lamp = at(
      MIDNIGHT,
      { x: 10.5, y: 10.5 },
      {
        ...town,
        objects: [{ contentId: 'fixture:lantern', x: 12, y: 10 }],
      },
    );
    expect(light(lamp)).toBe(1);
    expect(light(lamp, 50.5, 50.5)).toBeCloseTo(LIGHT.moon, 5);
  });
});

describe('light: tree crowns shade (SimChunk.trees)', () => {
  // One tree at (10, 10): crown radius 3 m from 2 m to 8 m; another crossing a chunk border.
  const park: MapSpec = {
    width: 64,
    height: 64,
    trees: [
      { x: 10, y: 10, r: 3, bottom: 2, top: 8 },
      { x: 31.5, y: 50, r: 3, bottom: 2, top: 8 },
    ],
  };

  it('under a crown and in its shadow by day: tree shade (lighter than a building)', () => {
    const sim = at(NOON, { x: 10.5, y: 10.5 }, park);
    expect(light(sim)).toBeCloseTo(LIGHT.treeShadeMul, 5);
    expect(LIGHT.treeShadeMul).toBeGreaterThan(LIGHT.shadowMul);
    // Noon sun in the south: the crown's shadow falls north of the trunk, not south.
    expect(light(sim, 10.5, 5.5)).toBeCloseTo(LIGHT.treeShadeMul, 5);
    expect(light(sim, 10.5, 16.5)).toBe(1);
    // Far away: sunlit.
    expect(light(sim, 50.5, 10.5)).toBe(1);
  });

  it('a crown reaches over the chunk border', () => {
    const sim = at(NOON, { x: 33.5, y: 50.5 }, park);
    expect(light(sim)).toBeCloseTo(LIGHT.treeShadeMul, 5);
  });

  it('at night a tree adds nothing (moonlight)', () => {
    const sim = at(MIDNIGHT, { x: 10.5, y: 10.5 }, park);
    expect(light(sim)).toBeCloseTo(LIGHT.moon, 5);
  });

  it('standing still in tree shade by day is less visible than in the open', () => {
    const shade = at(NOON, { x: 10.5, y: 10.5 }, park);
    const open = at(NOON, { x: 50.5, y: 50.5 }, park);
    for (let i = 0; i < 10; i++) {
      shade.step();
      open.step();
    }
    expect(vis(shade)).toBeLessThan(vis(open));
    expect(stealthOf(vis(open))).toBe('lit');
  });
});

describe('visibility and stealth', () => {
  it('still in the dark ≈ hidden; moving in the dark dim; daylight lit', () => {
    const night = at(MIDNIGHT, { x: 10.5, y: 10.5 });
    expect(vis(night)).toBeLessThanOrEqual(STEALTH_HIDDEN_MAX);
    expect(stealthOf(vis(night))).toBe('hidden');
    send(night, { type: 'move', dx: 1, dy: 0 });
    for (let i = 0; i < 10; i++) night.step();
    expect(stealthOf(vis(night))).toBe('dim');
    expect(vis(night)).toBeCloseTo(VC.nightFactor, 5);

    const day = at(NOON, { x: 10.5, y: 10.5 });
    expect(vis(day)).toBe(1);
    expect(stealthOf(vis(day))).toBe('lit');
    // Standing still in a building's shadow by day: dim.
    const shade = at(NOON, { x: 30.5, y: 28.5 });
    for (let i = 0; i < 10; i++) shade.step();
    expect(vis(shade)).toBeLessThanOrEqual(STEALTH_DIM_MAX);
    expect(stealthOf(vis(shade))).toBe('dim');
  });

  it('view: visibility, stealth and lightLevel', () => {
    const sim = at(MIDNIGHT, { x: 10.5, y: 10.5 });
    let last: SimViewPatch | undefined;
    for (let v = sim.drainView(); v; v = sim.drainView()) last = v.stealth ? v : last;
    expect(last).toMatchObject({ stealth: 'hidden', lightLevel: 0.05 });
    expect(last?.visibility).toBeLessThanOrEqual(STEALTH_HIDDEN_MAX);
  });

  it('a zombie 2 tiles away does not see a player standing still in the dark, but sees one walking', () => {
    const run = (walk: boolean) => {
      const sim = aiSim({
        map: { width: 64, height: 64 },
        spawn: { x: 12.5, y: 10.5 },
        zombies: [{ x: 10.5, y: 10.5 }],
        clock: MIDNIGHT,
      });
      if (walk) send(sim, { type: 'move', dx: 0.3, dy: 0, gait: 'walk' });
      let chased = false;
      for (let i = 0; i < 40; i++) {
        sim.step();
        if (sim.getZombies()[0]!.state === 'chase') chased = true;
      }
      return chased;
    };
    expect(run(false)).toBe(false);
    expect(run(true)).toBe(true);
  });
});
