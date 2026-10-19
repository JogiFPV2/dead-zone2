import { expect, it } from 'vitest';
import {
  LATEST_MAP,
  isOldMap,
  parseBootOptions,
  parseCarParam,
  parseGiveParam,
  parseStatParam,
  parseTileListParam,
} from './boot-options.js';

it('uses the worker by default and the mock only for ?crowd', () => {
  expect(parseBootOptions('')).toEqual({
    map: 'test',
    crowd: 0,
    spawnInside: false,
    sim: 'worker',
    zones: false,
    timescale: 0,
    give: [],
    cars: [],
    pumps: [],
    stats: [],
    zombies: true,
    town: true,
    zspawn: 0,
    stress: false,
    stressChunks: 250,
    stressLatencyMs: 0,
    perf: false,
    render: { style: 'default', quality: 'medium' },
  });
  expect(parseBootOptions('?time=06:30&timescale=30')).toMatchObject({ time: 390, timescale: 30 });
  expect(parseBootOptions('?time=25:00').time).toBeUndefined();
  expect(parseBootOptions('?map=test-town&zones=1')).toMatchObject({
    map: 'test-town',
    zones: true,
  });
  expect(parseBootOptions('?crowd=200').sim).toBe('mock');
  expect(parseBootOptions('?footprint=1').footprint).toBe(true);
  expect(parseBootOptions('?footprint=0').footprint).toBeUndefined();
  expect(parseBootOptions('?stress=16')).toMatchObject({ stress: true, stressChunks: 512 });
  expect(parseBootOptions('?stress=1&latency=15&perf=1')).toMatchObject({
    stress: true,
    stressChunks: 250,
    stressLatencyMs: 15,
    perf: true,
    sim: 'mock',
  });
  expect(parseBootOptions('?spawn=inside')).toMatchObject({ spawnInside: true, sim: 'worker' });
  // Dev spawn on a floor level (stairs / upper floors testing).
  expect(parseBootOptions('?spawn=16.5,13.5,1').spawnAt).toEqual({ x: 16.5, y: 13.5, z: 1 });
  expect(parseBootOptions('?spawn=16.5,13.5').spawnAt).toEqual({ x: 16.5, y: 13.5 });
  expect(parseBootOptions('?sim=mock').sim).toBe('worker'); // removed: nothing needs it
  expect(parseBootOptions('?map=demo-house')).toMatchObject({ map: 'demo-house', sim: 'worker' });
  // The inside spawn belongs to the generated test map only.
  expect(parseBootOptions('?map=demo-house&spawn=inside')).toMatchObject({
    spawnInside: false,
    sim: 'worker',
  });
  expect(parseBootOptions('?map=town-2').map).toBe('town-2');
  expect(parseBootOptions('?map=../x').map).toBe('test');
});

it('parses ?give= item lists', () => {
  expect(parseGiveParam('base:kitchen-knife,base:canned-beans*3, bad ,x:y*500')).toEqual([
    { itemId: 'base:kitchen-knife', count: 1 },
    { itemId: 'base:canned-beans', count: 3 },
    { itemId: 'x:y', count: 99 },
  ]);
  expect(parseBootOptions('?give=base:bandage*2').give).toEqual([
    { itemId: 'base:bandage', count: 2 },
  ]);
});

it('parses ?stat= debug stats', () => {
  expect(parseStatParam('hunger:60, stress:40,pain:1,thirst:x')).toEqual([
    { stat: 'hunger', value: 60 },
    { stat: 'stress', value: 40 },
  ]);
  expect(parseBootOptions('').stats).toEqual([]);
});

it('parses dev TVs (`?tv=`)', () => {
  expect(parseBootOptions('?map=demo-house&tv=7,8;9,10').tvs).toEqual([
    { x: 7, y: 8 },
    { x: 9, y: 10 },
  ]);
  expect(parseBootOptions('?map=demo-house').tvs).toBeUndefined();
});

it('parses dev cars (`?car=`) and pumps (`?pump=`)', () => {
  expect(parseCarParam('12.5,20,90,18,locked+nokey;30,4')).toEqual([
    { x: 12.5, y: 20, heading: Math.PI / 2, fuel: 18, locked: true, key: 'none' },
    { x: 30, y: 4 },
  ]);
  expect(parseCarParam('1,2,0,5,glovebox')[0]).toMatchObject({ key: 'glovebox', fuel: 5 });
  expect(parseCarParam('x,2;')).toEqual([]);
  expect(parseTileListParam('10,12;bad;-3,4')).toEqual([
    { x: 10, y: 12 },
    { x: -3, y: 4 },
  ]);
  expect(parseBootOptions('?car=5,6&pump=7,8')).toMatchObject({
    cars: [{ x: 5, y: 6 }],
    pumps: [{ x: 7, y: 8 }],
  });
});

it('the newest map is the OSM map of Stalowa Wola (osm-stw)', () => {
  expect(LATEST_MAP).toBe('osm-stw');
  expect(isOldMap('osm-stw')).toBe(false);
  expect(isOldMap('test-town')).toBe(true);
  expect(isOldMap('test')).toBe(false);
});
