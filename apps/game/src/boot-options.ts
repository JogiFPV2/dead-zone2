import { DEBUG_STATS, type DebugStat } from '@deadzone/protocol';
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
  /** Dev `?give=base:kitchen-knife,base:canned-beans*3`: items put into the inventory at start. */
  give: { itemId: string; count: number }[];
  /** Dev `?stat=hunger:60,stress:40`: survival stats set at start (HUD testing). */
  stats: { stat: DebugStat; value: number }[];
  /** `?zombies=0` disables the start zombies on content maps. */
  zombies: boolean;
}

const DEBUG_STAT_SET: ReadonlySet<string> = new Set(DEBUG_STATS);

/** `stat:value` list, comma separated; unknown stats and non-numbers are skipped. */
export function parseStatParam(value: string | null): { stat: DebugStat; value: number }[] {
  if (!value) return [];
  const out: { stat: DebugStat; value: number }[] = [];
  for (const part of value.split(',')) {
    const [stat = '', v = ''] = part.trim().split(':');
    const n = Number(v);
    if (DEBUG_STAT_SET.has(stat) && v !== '' && Number.isFinite(n)) {
      out.push({ stat: stat as DebugStat, value: n });
    }
  }
  return out;
}

/** `id[*count]` list, comma separated; invalid entries are skipped, count clamped to 1..99. */
export function parseGiveParam(value: string | null): { itemId: string; count: number }[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => /^([a-z0-9-]+:[a-z0-9-]+)(?:\*(\d+))?$/.exec(part.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ itemId: m[1] ?? '', count: Math.min(99, Math.max(1, Number(m[2] ?? 1))) }));
}

/** Parses the URL query (`?map=<base map>`, e.g. `demo-house`, `?crowd=N`, `?spawn=inside`, `?zones=1`). */
export function parseBootOptions(search: string): BootOptions {
  const q = new URLSearchParams(search);
  const crowd = parseCrowdParam(search);
  const spawnInside = q.get('spawn') === 'inside';
  const name = q.get('map') ?? '';
  // Public build (production): test-town with containers by default; dev: generated test map.
  const fallback: MapChoice = import.meta.env.PROD ? 'test-town' : 'test';
  const map: MapChoice = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name : fallback;
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
    give: parseGiveParam(q.get('give')),
    stats: parseStatParam(q.get('stat')),
    zombies: q.get('zombies') !== '0',
  };
}
