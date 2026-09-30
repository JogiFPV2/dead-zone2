import { expect, it } from 'vitest';
import { parseBootOptions } from './boot-options.js';

it('uses the worker by default and the mock only for mock-only debug options', () => {
  expect(parseBootOptions('')).toEqual({
    map: 'test',
    crowd: 0,
    spawnInside: false,
    sim: 'worker',
  });
  expect(parseBootOptions('?crowd=200').sim).toBe('mock');
  expect(parseBootOptions('?spawn=inside')).toMatchObject({ spawnInside: true, sim: 'mock' });
  expect(parseBootOptions('?sim=mock').sim).toBe('mock');
  expect(parseBootOptions('?map=demo-house')).toMatchObject({ map: 'demo-house', sim: 'worker' });
  // The inside spawn belongs to the generated test map only.
  expect(parseBootOptions('?map=demo-house&spawn=inside')).toMatchObject({
    spawnInside: false,
    sim: 'worker',
  });
  expect(parseBootOptions('?map=town-2').map).toBe('town-2');
  expect(parseBootOptions('?map=../x').map).toBe('test');
});
