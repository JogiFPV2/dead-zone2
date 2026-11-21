import { WEATHER_EFFECTS, weatherAt, type SimViewPatch } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { LIGHT, lightLevelAt, playerVisibility } from '../ai/light.js';
import { aiSim, MIDNIGHT, NOON } from '../test/ai-fixtures.js';
import { fixtureContent, runMinutes, survivalSim } from '../test/content-fixtures.js';
import { buildMap, type MapSpec } from '../test/fixtures.js';
import { TileGrid } from './grid.js';
import { weatherNow } from './weather.js';

/** Building y ∈ [30, 40), x ∈ [20, 40), 2 levels; open ground elsewhere. */
const town: MapSpec = {
  width: 64,
  height: 64,
  levels: 2,
  room: (x, y) => (x >= 20 && x < 40 && y >= 30 && y < 40 ? 1 : 0),
  rooms: { '1': 'base:room-kitchen' },
};

function lightAt(weather: 'clear' | 'overcast' | 'fog' | 'off', clock = NOON, x = 10.5, y = 10.5) {
  const sim = aiSim({ map: town, spawn: { x, y }, clock, weather });
  sim.step();
  const w = sim.world;
  const level = lightLevelAt(w, w.ai!, new TileGrid(buildMap(town)), x, y, 0);
  return { sim, level, vis: playerVisibility(w, w.ai!, w.players.get(0)!, level) };
}

describe('weather in the sim (docs 9.45)', () => {
  it('off by default in the fixtures (old behaviour), forced kind via options', () => {
    const off = aiSim({ map: town });
    expect(weatherNow(off.world)).toBeUndefined();
    const rain = aiSim({ map: town, weather: 'rain' });
    expect(weatherNow(rain.world)?.kind).toBe('rain');
  });

  it('clouds dim the day and soften building shadows', () => {
    expect(lightAt('clear').level).toBeCloseTo(1 - LIGHT.cloudDayDim * 0.1, 4);
    const overcast = lightAt('overcast').level;
    expect(overcast).toBeCloseTo(1 - LIGHT.cloudDayDim * 0.85, 4);
    // In the shadow north of the building: weaker shadow under clouds.
    const shadeClear = lightAt('clear', NOON, 30.5, 28.5).level / lightAt('clear').level;
    const shadeOvercast = lightAt('overcast', NOON, 30.5, 28.5).level / overcast;
    expect(shadeClear).toBeLessThan(shadeOvercast);
  });

  it('fog cuts how far zombies see the player', () => {
    expect(lightAt('fog').vis).toBeLessThan(lightAt('clear').vis * 0.6);
  });

  it('moon phase: full moon on game day 1, a new moon two weeks later is darker', () => {
    const full = lightAt('clear', MIDNIGHT).level;
    const sim = aiSim({ map: town, clock: { day: 16, hour: 0, minute: 0 }, weather: 'clear' });
    sim.step();
    const w = sim.world;
    const newMoon = lightLevelAt(w, w.ai!, new TileGrid(buildMap(town)), 10.5, 10.5, 0);
    expect(newMoon).toBeLessThan(full * 0.5);
    // Darker than moonlight → sight below nightFactor (weather on).
    const vis = playerVisibility(w, w.ai!, w.players.get(0)!, newMoon);
    expect(vis).toBeLessThan(w.ai!.cfg.vision.nightFactor * LIGHT.stillDarkMul + 1e-6);
  });

  it('rain wets the player outdoors, not indoors; weather lowers the air temperature', () => {
    const content = fixtureContent();
    const out = survivalSim(content, { weather: 'rain', map: buildMap(town) });
    const inside = survivalSim(content, {
      weather: 'rain',
      map: buildMap(town),
      spawn: { x: 30.5, y: 35.5 },
    });
    runMinutes(out, 11);
    runMinutes(inside, 11);
    expect(out.getSurvival()!.stats.wetness).toBeGreaterThan(3);
    expect(inside.getSurvival()!.stats.wetness ?? 0).toBe(0);
    expect(WEATHER_EFFECTS.rain.tempC).toBeLessThan(0);
  });

  it('view: weather sent on change with the moon', () => {
    const sim = aiSim({ map: town, weather: 'storm' });
    let wx: SimViewPatch['weather'];
    for (let i = 0; i < 3; i++) {
      sim.step();
      for (let v = sim.drainView(); v; v = sim.drainView()) wx = v.weather ?? wx;
    }
    expect(wx).toMatchObject({ kind: 'storm', hearingMul: 0.5 });
    expect(wx!.moon).toBe(weatherAt(sim.world.seed, 12 * 60, undefined, 'storm').moon);
  });
});
