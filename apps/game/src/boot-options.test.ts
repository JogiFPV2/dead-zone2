import { expect, it } from 'vitest';
import { parseBootOptions, parseGiveParam, parseStatParam } from './boot-options.js';

it('uses the worker by default and the mock only for ?crowd', () => {
  expect(parseBootOptions('')).toEqual({
    map: 'test',
    crowd: 0,
    spawnInside: false,
    sim: 'worker',
    zones: false,
    timescale: 0,
    give: [],
    stats: [],
    zombies: true,
    zspawn: 0,
  });
  expect(parseBootOptions('?time=06:30&timescale=30')).toMatchObject({ time: 390, timescale: 30 });
  expect(parseBootOptions('?time=25:00').time).toBeUndefined();
  expect(parseBootOptions('?map=test-town&zones=1')).toMatchObject({
    map: 'test-town',
    zones: true,
  });
  expect(parseBootOptions('?crowd=200').sim).toBe('mock');
  expect(parseBootOptions('?spawn=inside')).toMatchObject({ spawnInside: true, sim: 'worker' });
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
