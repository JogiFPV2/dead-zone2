/** Road cross-section from OSM tags (width, lanes, direction, sidewalks, markings). */
export type Tags = Readonly<Record<string, string>>;

export type RoadClass =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'living'
  | 'service'
  | 'track'
  | 'path'
  | 'footway'
  | 'cycleway'
  | 'steps';

export interface RoadProfile {
  cls: RoadClass;
  /** `_link` ramp (włączenie / zjazd). */
  link: boolean;
  /** Carriageway width (m), kerb to kerb. */
  width: number;
  /** Where the width came from. */
  widthFrom: 'width' | 'lanes' | 'default';
  lanes: number;
  /** 1 = along the way, -1 = against, 0 = both directions. */
  oneway: -1 | 0 | 1;
  roundabout: boolean;
  /** Sidewalk width on the left / right of the way direction (0 = none or mapped separately). */
  sidewalk: [number, number];
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  /** Dashed centre line (two-way, ≥ 2 lanes, motor road). */
  centreLine: boolean;
  /** Lane divider lines (more than one lane in a direction). */
  laneLines: boolean;
}

const CLASS: Record<string, RoadClass> = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  unclassified: 'residential',
  residential: 'residential',
  road: 'residential',
  living_street: 'living',
  service: 'service',
  track: 'track',
  path: 'path',
  bridleway: 'path',
  footway: 'footway',
  pedestrian: 'footway',
  cycleway: 'cycleway',
  steps: 'steps',
};

/** Lane width (m) and default lanes (both directions) per class. */
const LANE: Record<RoadClass, [number, number]> = {
  motorway: [3.75, 4],
  trunk: [3.5, 4],
  primary: [3.5, 2],
  secondary: [3.25, 2],
  tertiary: [3, 2],
  residential: [2.75, 2],
  living: [2.5, 2],
  service: [3, 1],
  track: [3, 1],
  path: [1.5, 1],
  footway: [2, 1],
  cycleway: [2, 1],
  steps: [2, 1],
};

/** Classes that carry cars (graph for junctions, markings, sidewalks). */
export const MOTOR: ReadonlySet<RoadClass> = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'living',
  'service',
]);

/** Default sidewalk on both sides (urban classes); service, track and paths have none. */
const SIDEWALK_DEFAULT: Partial<Record<RoadClass, number>> = {
  primary: 2,
  secondary: 2,
  tertiary: 2,
  residential: 1.5,
};

export function parseWidth(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(m)?\s*$/.exec(v);
  if (!m) return undefined;
  const w = Number.parseFloat(m[1]!.replace(',', '.'));
  return w >= 1 && w <= 40 ? w : undefined;
}

function sidewalks(t: Tags, def: number): [number, number] {
  const side = (s: 'left' | 'right'): number => {
    const own = t[`sidewalk:${s}`] ?? t['sidewalk:both'];
    const all = t.sidewalk;
    const v =
      own ??
      (all === 'both' || all === 'yes'
        ? 'yes'
        : all === s
          ? 'yes'
          : all === 'left' || all === 'right'
            ? 'no'
            : all);
    if (v === 'no' || v === 'none' || v === 'separate') return 0;
    if (v === 'yes') return def || 1.5;
    return def;
  };
  return [side('left'), side('right')];
}

/** undefined = not a drawn road (proposed, construction, area, platform, …). */
export function roadProfile(t: Tags): RoadProfile | undefined {
  const h = t.highway;
  if (!h || t.area === 'yes') return undefined;
  const link = h.endsWith('_link');
  const cls = CLASS[link ? h.slice(0, -5) : h];
  if (!cls) return undefined;
  const roundabout = t.junction === 'roundabout' || t.junction === 'circular';
  const ow = t.oneway;
  const oneway: -1 | 0 | 1 =
    ow === '-1' || ow === 'reverse'
      ? -1
      : ow === 'yes' || ow === '1' || ow === 'true' || roundabout || cls === 'motorway'
        ? ow === 'no'
          ? 0
          : 1
        : 0;
  const [laneW, defLanes] = LANE[cls];
  const tagLanes = t.lanes ? Number.parseInt(t.lanes, 10) : NaN;
  const lanes =
    Number.isFinite(tagLanes) && tagLanes >= 1 && tagLanes <= 8
      ? tagLanes
      : link || oneway !== 0
        ? MOTOR.has(cls) && defLanes > 2
          ? defLanes / 2
          : 1
        : defLanes;
  const tagW = parseWidth(t.width);
  const width = tagW ?? Math.max(MOTOR.has(cls) ? 3 : 1, Math.round(lanes * laneW * 4) / 4);
  const widthFrom = tagW !== undefined ? 'width' : Number.isFinite(tagLanes) ? 'lanes' : 'default';
  const sw = link || roundabout ? 0 : (SIDEWALK_DEFAULT[cls] ?? 0);
  const motor = MOTOR.has(cls) && cls !== 'service';
  const perDir = oneway !== 0 ? lanes : lanes / 2;
  return {
    cls,
    link,
    width,
    widthFrom,
    lanes,
    oneway,
    roundabout,
    sidewalk: MOTOR.has(cls) ? sidewalks(t, sw) : [0, 0],
    layer: Number.parseInt(t.layer ?? '0', 10) || 0,
    bridge: !!t.bridge && t.bridge !== 'no',
    tunnel: !!t.tunnel && t.tunnel !== 'no',
    centreLine: motor && oneway === 0 && lanes >= 2,
    laneLines: motor && perDir > 1,
  };
}

/** Corner radius (m) at a junction by the larger class meeting there (PL kerb radii, WT 2022). */
export function cornerRadius(cls: RoadClass): number {
  switch (cls) {
    case 'motorway':
    case 'trunk':
      return 15;
    case 'primary':
      return 12;
    case 'secondary':
      return 10;
    case 'tertiary':
      return 8;
    case 'residential':
    case 'living':
      return 6;
    default:
      return 4;
  }
}

/** Rank for "larger class" decisions (lower = bigger road). */
export const CLASS_RANK: readonly RoadClass[] = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'living',
  'service',
  'track',
  'cycleway',
  'footway',
  'path',
  'steps',
];
