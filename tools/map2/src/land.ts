/**
 * Stage 4: the ground 1:1 with OSM in the map2 frame (`project.ts`, no rotation): areas (water,
 * forest, parks, fields, landuse… with holes), hedges, waterways, railways, power lines, single
 * trees, tree rows, rail nodes and POIs. Geometry keeps every OSM vertex; tags are passed on and
 * classified by the client map writer (`tools/map` `map2-land.ts`, `classifyArea`).
 */
import type { Projection } from './project.js';

export type LonLat = [number, number];
export type Pt = [number, number];
type Tags = Record<string, string>;

/** `deadzone-osm-land-raw-2` (scripts/extract_land.py). */
export interface RawLand2 {
  format: 'deadzone-osm-land-raw-2';
  bbox: [number, number, number, number];
  source: string;
  license: string;
  areas: { id: number; way: boolean; t: Tags; rings: { outer: LonLat[]; inner: LonLat[][] }[] }[];
  lines: { id: number; t: Tags; g: LonLat[] }[];
  nodes: { id: number; p: LonLat; t: Tags }[];
}

export interface LandArea {
  id: number;
  /** Closed way (true) or multipolygon relation. */
  way: boolean;
  /** Ring index within a multipolygon (outer rings are separate areas). */
  ring: number;
  tags: Tags;
  outer: Pt[];
  inner: Pt[][];
}
export interface LandLine {
  id: number;
  tags: Tags;
  pts: Pt[];
}
export interface LandNode {
  id: number;
  tags: Tags;
  xy: Pt;
}
export interface Land2 {
  areas: LandArea[];
  lines: LandLine[];
  nodes: LandNode[];
}

/** Drops consecutive duplicate vertices (zero-length edges); keeps the closing vertex. */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out;
}

export function buildLand(raw: RawLand2, proj: Projection): Land2 {
  const pt = ([lon, lat]: LonLat): Pt => proj.toLocal(lon, lat);
  const areas: LandArea[] = [];
  for (const a of raw.areas)
    a.rings.forEach((r, ring) => {
      const outer = dedupe(r.outer.map(pt));
      if (outer.length < 4) return;
      areas.push({
        id: a.id,
        way: a.way,
        ring,
        tags: a.t,
        outer,
        inner: r.inner.map((i) => dedupe(i.map(pt))).filter((i) => i.length >= 4),
      });
    });
  const lines = raw.lines
    .map((l) => ({ id: l.id, tags: l.t, pts: dedupe(l.g.map(pt)) }))
    .filter((l) => l.pts.length >= 2);
  const nodes = raw.nodes.map((n) => ({ id: n.id, tags: n.t, xy: pt(n.p) }));
  return { areas, lines, nodes };
}
