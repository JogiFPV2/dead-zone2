// Every window on the generated maps can be climbed through both ways (Paweł 25.10): the player
// stands in front of it and lands beyond it (`windowPassIssue`, the `startVault` landing rule).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASE_PACK_DIR, buildContentBundleFromDirs } from '@deadzone/content/node';
import { OSM_REGIONS, PlanChunkGenerator, osmPlan, type OsmMap } from '@deadzone/map/world-source';
import { CHUNK_SIZE, simMapFromWorldSource, type WorldSource } from '@deadzone/protocol';
import { createSim, gridOf, windowPassIssue } from '@deadzone/sim';
import { describe, expect, it } from 'vitest';
import { loadWorld } from './load-plan.js';
import { GENERATED_MAPS } from './maps.js';
import { CENTRUM_SPOT, publicFetch } from './osm16-fixtures.js';
import { generatorWorldSource } from './sim-world.js';

const FILE = fileURLToPath(
  new URL('../../../public/osm/stw-okulickiego.deadzone-osm-1.json', import.meta.url),
);

function openOsm(): PlanChunkGenerator {
  const buf = readFileSync(FILE);
  const r = OSM_REGIONS.okulickiego;
  return new PlanChunkGenerator(
    osmPlan(JSON.parse(buf.toString('utf8')) as OsmMap, {
      dataHash: createHash('sha256').update(buf).digest('hex'),
      bounds: r.bounds,
      start: r.start,
      region: 'okulickiego',
    }),
  );
}

export interface WindowIssue {
  at: string;
  issue: string;
  /** Furniture on the blocked tile (`*-furniture`). */
  what?: string;
}

/** All windows of the chunks [cx0..cx1] × [cy0..cy1], every level; issues per side. */
export async function scanWindows(
  world: WorldSource,
  start: { x: number; y: number },
  range: { cx0: number; cy0: number; cx1: number; cy1: number },
): Promise<{ windows: number; upperVoid: number; issues: WindowIssue[] }> {
  const content = await buildContentBundleFromDirs([BASE_PACK_DIR]);
  const sim = createSim({
    seed: 1,
    map: simMapFromWorldSource(world),
    world,
    content,
    spawn: { x: start.x, y: start.y, z: 0 },
  });
  const w = sim.world;
  const grid = gridOf(w);
  const map = w.map;
  const furnitureAt = (fx: number, fy: number, fz: number): string => {
    const ocx = Math.floor(fx / CHUNK_SIZE);
    const ocy = Math.floor(fy / CHUNK_SIZE);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const o of map.getChunk(ocx + dx, ocy + dy, fz)?.objects ?? []) {
          const s = w.furniture?.sizeOf(o.contentId, o.rot);
          if (!s) continue;
          const ox = (ocx + dx) * CHUNK_SIZE + o.x;
          const oy = (ocy + dy) * CHUNK_SIZE + o.y;
          if (fx >= ox && fx < ox + s.w && fy >= oy && fy < oy + s.h) return o.contentId;
        }
    return '?';
  };
  let windows = 0;
  let upperVoid = 0;
  const issues: WindowIssue[] = [];
  for (let cy = range.cy0; cy <= range.cy1; cy++)
    for (let cx = range.cx0; cx <= range.cx1; cx++)
      for (let z = 0; z < 8; z++) {
        const ch = map.getChunk(cx, cy, z);
        if (!ch) continue;
        for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
          const tx = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
          const ty = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
          for (const side of [0, 1]) {
            const id = side === 0 ? ch.edgeN[i]! : ch.edgeW[i]!;
            if (map.edgeKinds?.[id] !== 'window') continue;
            windows++;
            const a = windowPassIssue(w, grid, side, tx, ty, z, true);
            const b = windowPassIssue(w, grid, side, tx, ty, z, false);
            // Upper floor with nothing beyond: a drop, not a climb (only one side is a floor).
            if (z > 0 && (a === 'from-no-floor' || b === 'from-no-floor')) {
              upperVoid++;
              continue;
            }
            const at = `${side ? 'w' : 'n'} ${tx},${ty},${z}`;
            // Tile on the low (n / w) and high side of the edge.
            const lo = side ? [tx - 1, ty] : [tx, ty - 1];
            const hi = [tx, ty];
            const what = (issue: string, fromLow: boolean) => {
              if (!issue.endsWith('furniture')) return {};
              const [fx, fy] = (issue.startsWith('from') === fromLow ? lo : hi) as [number, number];
              return { what: furnitureAt(fx, fy, z) };
            };
            if (a)
              issues.push({ at: `${at} from ${side ? 'w' : 'n'}`, issue: a, ...what(a, true) });
            if (b)
              issues.push({ at: `${at} from ${side ? 'e' : 's'}`, issue: b, ...what(b, false) });
          }
        }
      }
  return { windows, upperVoid, issues };
}

const summary = (issues: WindowIssue[]) => {
  const n: Record<string, number> = {};
  for (const i of issues) n[i.issue] = (n[i.issue] ?? 0) + 1;
  return n;
};

/**
 * Blocked sides left to the map generator (tools/map, Silnik): furniture / yard props on the tile
 * in front of a window, slanted-wall gaps off the raster window. Lower these as it is fixed; any
 * other cause (wall, no floor, blocker) is a sim regression and must stay 0.
 */
// rev 18 (#351): windows every 2.25 m + one per room (72 244 → 73 687 / 26 515 → 27 139 windows),
// blocked share 0.70 % → 0.65 % / 0.57 % → 0.61 %; stw raised 150 → 166 with the denser windows.
// Slanted walls get windows on their staircase steps too (fewWindows 0 in building-shape.test):
// okulickiego ground-floor windows 11 360 (rev 17) → 13 120; raised 476 → 570 with them.
// Strip along slanted walls floored upstairs (joinStrip): 10 635 upper windows that dropped into
// the void are now climbable checks; furniture in front of 126 of them: raised 570 → 766.
const OKULICKIEGO_MAX = { furniture: 766, segment: 0 };
const STW_MAX = { furniture: 166, segment: 0 };

function ratchet(issues: WindowIssue[], max: { furniture: number; segment: number }) {
  const furniture = issues.filter((i) => i.issue.endsWith('-furniture')).length;
  const segment = issues.filter((i) => i.issue.endsWith('-segment')).length;
  const other = issues.filter((i) => !/-(furniture|segment)$/.test(i.issue));
  expect(other.slice(0, 20)).toEqual([]);
  expect(furniture).toBeLessThanOrEqual(max.furniture);
  expect(segment).toBeLessThanOrEqual(max.segment);
}

function report(name: string, r: Awaited<ReturnType<typeof scanWindows>>) {
  const out = process.env.WINDOW_REPORT;
  if (!out) return;
  const what: Record<string, number> = {};
  for (const i of r.issues) if (i.what) what[i.what] = (what[i.what] ?? 0) + 1;
  writeFileSync(
    `${out}-${name}.json`,
    JSON.stringify(
      {
        windows: r.windows,
        upperVoid: r.upperVoid,
        summary: summary(r.issues),
        what,
        issues: r.issues,
      },
      null,
      1,
    ),
  );
}

describe('windows: every one can be climbed through both ways', () => {
  it('osm-okulickiego (whole map)', async () => {
    const gen = openOsm();
    const r = await scanWindows(generatorWorldSource(gen), gen.start(), gen.bounds);
    report('okulickiego', r);
    expect(r.windows).toBeGreaterThan(100);
    ratchet(r.issues, OKULICKIEGO_MAX);
  }, 300_000);
});

describe.runIf(process.env.WINDOW_SCAN_STW)(
  'windows: osm-stw around the start and the centrum',
  () => {
    it('osm-stw (start 3 × 3 km tiles + centrum)', async () => {
      const t = (await loadWorld(GENERATED_MAPS['osm-stw']!, publicFetch())).tiles!;
      const g = t.generator;
      const s = g.start();
      const spots = [s, CENTRUM_SPOT];
      let windows = 0;
      let upperVoid = 0;
      const issues: WindowIssue[] = [];
      for (const p of spots) {
        const cx = Math.floor(p.x / CHUNK_SIZE);
        const cy = Math.floor(p.y / CHUNK_SIZE);
        const range = { cx0: cx - 8, cy0: cy - 8, cx1: cx + 8, cy1: cy + 8 };
        for (let y = range.cy0; y <= range.cy1; y++)
          for (let x = range.cx0; x <= range.cx1; x++) await t.ensure(x, y);
        const r = await scanWindows(generatorWorldSource(g, 400, t), p, range);
        windows += r.windows;
        upperVoid += r.upperVoid;
        issues.push(...r.issues);
      }
      report('stw', { windows, upperVoid, issues });
      expect(windows).toBeGreaterThan(100);
      ratchet(issues, STW_MAX);
    }, 600_000);
  },
);
