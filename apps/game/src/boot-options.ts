import { DEBUG_STATS, type DebugStat, type SimVehicleSpawn } from '@deadzone/protocol';
import { parseCrowdParam } from './crowd/mock-crowd.js';
import { parseTimeParam } from './lighting/game-clock.js';
import { parseRenderOptions, type RenderOptions } from './render/real/options.js';

/**
 * `test` = generated test map; a generated world (`world/gen/maps.ts`: `osm-stw` = OSM map of
 * Stalowa Wola, `plan-4` = plan-4 generator); anything else = a map folder of the base pack
 * (`base:<name>`).
 */
export type MapChoice = 'test' | (string & {});

export interface BootOptions {
  map: MapChoice;
  /** `?crowd=N` wanderers; only the mock sim has them. */
  crowd: number;
  /** `?spawn=inside`: start in the test building (generated test map only). */
  spawnInside: boolean;
  /**
   * Dev `?spawn=16.5,12.5` or `?spawn=16.5,12.5,1`: start at this tile point (any map; UI
   * testing next to containers), optionally on floor level z (upper floors, stairs).
   */
  spawnAt?: { x: number; y: number; z?: number };
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
  /** Dev `?zspawn=N`: N zombies spawned 2 tiles east (within near-sense) of the player at start. */
  zspawn: number;
  /** `?animals=N`: animals at the start of a new world (default by map size, 0 = none). */
  animals?: number;
  /** `?zombies=0` disables the start zombies on content maps. */
  zombies: boolean;
  /**
   * `?stress=1`: procedural 8 × 8 km dummy world (chunk streaming test, mock sim, no sim map);
   * `&latency=N` adds N ms per chunk fetch.
   */
  stress: boolean;
  /** `?stress=16`: the stress world is 512 × 512 chunks (16 384 m, floating-origin test). */
  stressChunks: number;
  stressLatencyMs: number;
  /** `?perf=1`: perf overlay (fps, frame ms, streamed chunks, draw calls, memory); any build. */
  perf: boolean;
  /** `?town=0`: grey-box world instead of the town kit (comparison, fallback). */
  town: boolean;
  /**
   * Dev `?car=x,y[,headingDeg[,fuelL[,flags]]]` (`;` between cars; flags `locked`, `glovebox`,
   * `nokey` joined by `+`): parked cars at start (vehicle UI testing; no map has cars yet).
   */
  cars: SimVehicleSpawn[];
  /** Dev `?pump=x,y` (`;` between pumps): `base:fuel-pump` map objects on these tiles. */
  pumps: { x: number; y: number }[];
  /** Dev `?tv=x,y` (`;` between): `base:tv` map objects (no content map has a TV yet). */
  tvs?: { x: number; y: number }[];
  /** Dev `?cam=x,z,viewH`: camera pinned at a world point with that view height (screenshots). */
  cam?: { x: number; z: number; viewHeight: number };
  /**
   * Dev `?footprint=1`: furniture footprints drawn on regardless of
   * `worldSettings.furniture.footprint` (render only; the sim follows its own settings).
   */
  footprint?: true;
  /**
   * `?style=real&quality=low|medium|high`: realistic PBR pilot (`render.style = 'real'`); the
   * default look is untouched when absent.
   */
  render: RenderOptions;
  /** Dev `?pbrdemo=x,z` (with `?style=real`): Designer's PBR models laid out at that tile. */
  pbrDemo?: { x: number; z: number };
}

/**
 * The newest playable map: every new game in the public build starts on it. A character saved on
 * another content map keeps loading there (its `worldSettings.map`) and its card says „stara mapa”.
 */
export const LATEST_MAP: MapChoice = 'osm-stw';

/** A saved world on a content map other than the newest one (the dev test map never counts). */
export const isOldMap = (map: string): boolean => map !== LATEST_MAP && map !== 'test';

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

const NUM = /^-?\d+(?:\.\d+)?$/;

/** `x,y[,headingDeg[,fuelL[,flags]]]` list (`;`), see `BootOptions.cars`; at most 8 cars. */
export function parseCarParam(value: string | null): SimVehicleSpawn[] {
  if (!value) return [];
  const out: SimVehicleSpawn[] = [];
  for (const part of value.split(';').slice(0, 8)) {
    const [x = '', y = '', deg, fuel, flags = ''] = part.trim().split(',');
    if (!NUM.test(x) || !NUM.test(y)) continue;
    const f = new Set(flags.split('+'));
    out.push({
      x: Number(x),
      y: Number(y),
      ...(deg && NUM.test(deg) ? { heading: (Number(deg) * Math.PI) / 180 } : {}),
      ...(fuel && NUM.test(fuel) ? { fuel: Number(fuel) } : {}),
      ...(f.has('locked') ? { locked: true } : {}),
      ...(f.has('glovebox')
        ? { key: 'glovebox' as const }
        : f.has('nokey')
          ? { key: 'none' as const }
          : {}),
    });
  }
  return out;
}

/** `x,y` tile list (`;`), at most 8. */
export function parseTileListParam(value: string | null): { x: number; y: number }[] {
  if (!value) return [];
  return value
    .split(';')
    .slice(0, 8)
    .map((p) => p.trim().split(','))
    .filter(([x = '', y = '']) => /^-?\d+$/.test(x) && /^-?\d+$/.test(y))
    .map(([x, y]) => ({ x: Number(x), y: Number(y) }));
}

/** Parses the URL query (`?map=<base map>`, e.g. `demo-house`, `?crowd=N`, `?spawn=inside`, `?zones=1`). */
export function parseBootOptions(search: string): BootOptions {
  const q = new URLSearchParams(search);
  const crowd = parseCrowdParam(search);
  const spawnInside = q.get('spawn') === 'inside';
  const name = q.get('map') ?? '';
  // Public build (production): the newest playable map; dev: generated test map.
  const fallback: MapChoice = import.meta.env.PROD ? LATEST_MAP : 'test';
  const map: MapChoice = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name : fallback;
  const stress = q.get('stress') === '1' || q.get('stress') === '16';
  const mock = crowd > 0 || stress;
  const time = parseTimeParam(q.get('time'));
  const at = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(-?\d{1,2}))?$/.exec(q.get('spawn') ?? '');
  const cam = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(q.get('cam') ?? '');
  const demo = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(q.get('pbrdemo') ?? '');
  return {
    map,
    crowd,
    spawnInside: spawnInside && map === 'test',
    ...(at
      ? {
          spawnAt: {
            x: Number(at[1]),
            y: Number(at[2]),
            ...(at[3] !== undefined ? { z: Number(at[3]) } : {}),
          },
        }
      : {}),
    sim: mock ? 'mock' : 'worker',
    zones: q.get('zones') === '1',
    ...(time !== undefined ? { time } : {}),
    timescale: Math.max(0, Math.min(1440, Number(q.get('timescale')) || 0)),
    give: parseGiveParam(q.get('give')),
    cars: parseCarParam(q.get('car')),
    pumps: parseTileListParam(q.get('pump')),
    ...(q.get('tv') !== null ? { tvs: parseTileListParam(q.get('tv')) } : {}),
    stats: parseStatParam(q.get('stat')),
    zombies: q.get('zombies') !== '0',
    ...(q.get('animals') !== null
      ? { animals: Math.max(0, Math.min(2000, Math.floor(Number(q.get('animals')) || 0))) }
      : {}),
    town: q.get('town') !== '0',
    ...(cam && Number(cam[3]) > 0
      ? { cam: { x: Number(cam[1]), z: Number(cam[2]), viewHeight: Number(cam[3]) } }
      : {}),
    zspawn: Math.max(0, Math.min(300, Math.floor(Number(q.get('zspawn')) || 0))),
    stress,
    stressChunks: q.get('stress') === '16' ? 512 : 250,
    stressLatencyMs: Math.max(0, Math.min(2000, Number(q.get('latency')) || 0)),
    perf: q.get('perf') === '1',
    ...(q.get('footprint') === '1' ? { footprint: true as const } : {}),
    render: parseRenderOptions(search),
    ...(demo ? { pbrDemo: { x: Number(demo[1]), z: Number(demo[2]) } } : {}),
  };
}
