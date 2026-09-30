import { parseCrowdParam } from './crowd/mock-crowd.js';

/** `test` = generated test map; anything else = a map folder of the base pack (`base:<name>`). */
export type MapChoice = 'test' | (string & {});

export interface BootOptions {
  map: MapChoice;
  /** `?crowd=N` wanderers; only the mock sim has them. */
  crowd: number;
  /** `?spawn=inside`: start in the test building (generated test map only). */
  spawnInside: boolean;
  /** Mock sim only for `?crowd=N` (the sim has no NPCs yet); otherwise the real sim worker. */
  sim: 'worker' | 'mock';
  /** Dev-only `?zones=1`: draw the map's zones (content maps only; the test map has none). */
  zones: boolean;
}

/** Parses the URL query (`?map=<base map>`, e.g. `demo-house`, `?crowd=N`, `?spawn=inside`, `?zones=1`). */
export function parseBootOptions(search: string): BootOptions {
  const q = new URLSearchParams(search);
  const crowd = parseCrowdParam(search);
  const spawnInside = q.get('spawn') === 'inside';
  const name = q.get('map') ?? '';
  const map: MapChoice = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name : 'test';
  const mock = crowd > 0;
  return {
    map,
    crowd,
    spawnInside: spawnInside && map === 'test',
    sim: mock ? 'mock' : 'worker',
    zones: q.get('zones') === '1',
  };
}
