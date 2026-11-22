/**
 * Playable maps generated lazily from a world plan (tools/map/src/world-source/README.md): one name per map for
 * `?map=` and `LATEST_MAP`. The OSM map of Stalowa Wola reads a static ODbL data file (GitHub
 * Pages later; a local copy in `public/osm/` for now), plan-4 is computed from its seed.
 */
export type GeneratedMapSpec =
  | {
      kind: 'osm';
      /** Window of the 16 km square (`OSM_REGIONS` in @deadzone/map/world-source). */
      region: 'okulickiego' | 'all';
      /** Data file (`deadzone-osm-1` JSON), relative to the game's base URL or absolute. */
      url: string;
    }
  | {
      /** The whole 16 km square as lazily loaded 1 km tiles (`deadzone-osm-tiles-1`). */
      kind: 'osm-tiles';
      /** Manifest URL (tiles next to it), relative to the game's base URL or absolute. */
      url: string;
    }
  | { kind: 'plan-4'; seed: number; size: number };

/** The OSM map of Stalowa Wola: the playable world source for `LATEST_MAP`. */
export const OSM_STW_MAP = 'osm-stw';

export const GENERATED_MAPS: Readonly<Record<string, GeneratedMapSpec>> = {
  [OSM_STW_MAP]: { kind: 'osm-tiles', url: 'osm/stw-16km/manifest.json' },
  /**
   * New OSM map (tools/map2, Paweł 01.11): north up, no rotation or straightening, 32 km square
   * (Stalowa Wola, Rozwadów, Huta, Nisko, San to the Vistula). Roads first; replaces `osm-stw`
   * once Paweł accepts it (`LATEST_MAP` stays until then).
   */
  stw2: { kind: 'osm-tiles', url: 'osm/stw2/manifest.json' },
  /** The 1.5 km window by ul. Okulickiego (single data file; small, for tests and comparisons). */
  'osm-okulickiego': {
    kind: 'osm',
    region: 'okulickiego',
    url: 'osm/stw-okulickiego.deadzone-osm-1.json',
  },
  'plan-4': { kind: 'plan-4', seed: 1, size: 16384 },
};

/** Spec of a generated map (`?map=osm-stw`, `?map=plan-4`), undefined for content maps. */
export function generatedMap(name: string): GeneratedMapSpec | undefined {
  return Object.hasOwn(GENERATED_MAPS, name) ? GENERATED_MAPS[name] : undefined;
}

/** Absolute data URL (`url` relative to the game's base URL; `?osmUrl=` overrides it in dev). */
export function resolveSpec(
  spec: GeneratedMapSpec,
  baseUrl: string,
  override?: string | null,
  /** Page URL: a relative base (`vite build --base ./`) is made absolute against it, because the
   * URL is fetched inside a worker, where relative URLs resolve against the worker script
   * (`assets/`), not the page. */
  pageUrl?: string,
): GeneratedMapSpec {
  if (spec.kind === 'plan-4') return spec;
  const url = override || spec.url;
  const joined = /^(https?:)?\/\//.test(url) || url.startsWith('/') ? url : `${baseUrl}${url}`;
  return { ...spec, url: pageUrl ? new URL(joined, pageUrl).href : joined };
}

/** Nearest named place (big map „location”, save summary). */
export function nearestPlace(
  places: readonly { name: string; x: number; y: number }[],
  x: number,
  y: number,
): string | undefined {
  let best: string | undefined;
  let bd = Infinity;
  for (const p of places) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = p.name;
    }
  }
  return best;
}

/** Chunk window of `r` chunks around a point, clamped to the world (level 0). */
export function genStartRange(
  b: { cx0: number; cy0: number; cx1: number; cy1: number },
  p: { x: number; y: number },
  r: number,
): { cx0: number; cy0: number; cx1: number; cy1: number; z: number } {
  const cx = Math.floor(p.x / 32);
  const cy = Math.floor(p.y / 32);
  return {
    cx0: Math.max(b.cx0, cx - r),
    cy0: Math.max(b.cy0, cy - r),
    cx1: Math.min(b.cx1, cx + r),
    cy1: Math.min(b.cy1, cy + r),
    z: 0,
  };
}
