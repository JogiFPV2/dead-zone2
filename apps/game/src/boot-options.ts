import { parseCrowdParam } from './crowd/mock-crowd.js';
import { parseTimeParam } from './lighting/game-clock.js';

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
  /** Dev `?time=HH:MM`: lighting at a fixed minute of day instead of the sim clock. */
  time?: number;
  /** Dev `?timescale=N` (with `?time`): game minutes per real second (0 = frozen). */
  timescale: number;
}

/** Parses the URL query (`?map=<base map>`, e.g. `demo-house`, `?crowd=N`, `?spawn=inside`, `?zones=1`). */
export function parseBootOptions(search: string): BootOptions {
  const q = new URLSearchParams(search);
  const crowd = parseCrowdParam(search);
  const spawnInside = q.get('spawn') === 'inside';
  const name = q.get('map') ?? '';
  const map: MapChoice = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name : 'test';
  const mock = crowd > 0;
  const time = parseTimeParam(q.get('time'));
  return {
    map,
    crowd,
    spawnInside: spawnInside && map === 'test',
    sim: mock ? 'mock' : 'worker',
    zones: q.get('zones') === '1',
    ...(time !== undefined ? { time } : {}),
    timescale: Math.max(0, Math.min(1440, Number(q.get('timescale')) || 0)),
  };
}
