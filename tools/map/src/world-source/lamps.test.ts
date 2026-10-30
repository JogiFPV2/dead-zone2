import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OsmMap } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import { chunkLamps, inBuilding, isLitRoad, lampOffset, nearestOn, onRoad } from './lamps.js';
import type { PlanIndex } from './plan-index.js';
import { OSM_REGIONS, osmPlan } from './sources.js';

const OSM = fileURLToPath(new URL('../../../../apps/game/public/osm/', import.meta.url));
const C = 32;

function okulickiego(): PlanIndex {
  const r = OSM_REGIONS.okulickiego;
  const map = JSON.parse(
    readFileSync(OSM + 'stw-okulickiego.deadzone-osm-1.json', 'utf8'),
  ) as OsmMap;
  return new PlanChunkGenerator(
    osmPlan(map, { dataHash: 't', bounds: r.bounds, start: r.start, region: 'okulickiego' }),
  ).index;
}

describe('latarnie z planu (Paweł 27.10)', () => {
  it('okulickiego: przy jezdni, poza jezdnią i budynkiem, ramię nad jezdnię, OSM użyte', () => {
    const idx = okulickiego();
    let lamps = 0;
    let osm = 0;
    let bad = 0;
    const samples: string[] = [];
    const xs = idx.roads.items.flatMap((r) => [r.pts[0]!, r.pts[1]!]);
    const max = Math.max(...xs);
    for (let cy = 0; cy * C < max; cy++)
      for (let cx = 0; cx * C < max; cx++)
        for (const l of chunkLamps(idx, cx * C, cy * C, C)) {
          lamps++;
          if (l.osm) osm++;
          const p = { x: l.x, y: l.y };
          if (inBuilding(idx, p)) {
            bad++;
            samples.push(`budynek ${l.x},${l.y}`);
          }
          if (l.osm) continue;
          // Generated lamps: beside a lit carriageway, off it, arm pointing at it.
          let near = false;
          for (const i of idx.roads.query({
            x0: l.x - 12,
            y0: l.y - 12,
            x1: l.x + 12,
            y1: l.y + 12,
          })) {
            const r = idx.roads.items[i]!;
            if (!isLitRoad(r)) continue;
            const h = nearestOn(r.pts, l.x, l.y);
            if (h.d > r.r - 0.06 && h.d <= lampOffset(r) + 0.05) {
              const toward = (h.px - l.x) * l.ax + (h.py - l.y) * l.ay;
              if (toward > 0) near = true;
            }
          }
          if (!near) {
            bad++;
            if (samples.length < 10) samples.push(`daleko ${l.x},${l.y}`);
          }
          if (onRoad(idx, p, -2) && !near) bad++;
        }
    process.stderr.write(
      `\n[latarnie] okulickiego ${JSON.stringify({ lamps, osm, bad })} ${samples.slice(0, 5).join('; ')}\n`,
    );
    expect(lamps).toBeGreaterThan(200);
    expect(osm).toBeGreaterThan(0);
    expect(bad).toBe(0);
  }, 300_000);
});
