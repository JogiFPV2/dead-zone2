// The whole 16 km square of Stalowa Wola (`osm-stw`, lazily loaded 1 km tiles).
import { CHUNK_KINDS, TILE_PALETTE, type OsmTiles } from '@deadzone/map/world-source';
import { CHUNK_SIZE } from '@deadzone/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadWorld } from './load-plan.js';
import { GENERATED_MAPS } from './maps.js';
import { CENTRUM_SPOT, publicFetch } from './osm16-fixtures.js';
import { generatorWorldSource } from './sim-world.js';

let tiles: OsmTiles;
const fetched: string[] = [];

beforeAll(async () => {
  const spec = GENERATED_MAPS['osm-stw']!;
  const w = await loadWorld(spec, publicFetch(fetched));
  tiles = w.tiles!;
}, 120_000);

describe('osm-stw: the whole 16 km square', () => {
  it('opens with the tiles around the start only, versioned by the data hash', () => {
    const g = tiles.generator;
    expect(g.version).toMatch(/^osm-stw-[0-9a-f]{12}-all-g34$/);
    expect(g.bounds).toEqual({ cx0: 0, cy0: 0, cx1: 703, cy1: 703 });
    // Manifest + 3 × 3 tiles, not 449.
    expect(fetched.length).toBeLessThanOrEqual(10);
    const s = g.start();
    const c = g.column(Math.floor(s.x / CHUNK_SIZE), Math.floor(s.y / CHUNK_SIZE))!;
    const i = (Math.floor(s.y) % CHUNK_SIZE) * CHUNK_SIZE + (Math.floor(s.x) % CHUNK_SIZE);
    expect(TILE_PALETTE[c.levels[0]!.floor[i]!]).toBe('base:sidewalk');
  });

  it('the centrum spot is a sidewalk in a centrum chunk, not in the park', async () => {
    const g = tiles.generator;
    const cx = Math.floor(CENTRUM_SPOT.x / CHUNK_SIZE);
    const cy = Math.floor(CENTRUM_SPOT.y / CHUNK_SIZE);
    expect(g.chunkKind(cx, cy)).toBe('centrum');
    await tiles.ensure(cx, cy);
    const c = g.column(cx, cy)!;
    const i =
      (Math.floor(CENTRUM_SPOT.y) % CHUNK_SIZE) * CHUNK_SIZE +
      (Math.floor(CENTRUM_SPOT.x) % CHUNK_SIZE);
    expect(TILE_PALETTE[c.levels[0]!.floor[i]!]).toBe('base:sidewalk');
  }, 180_000);

  it('knows the zone of every chunk and every place before the tiles are in', () => {
    const g = tiles.generator;
    const count: Record<string, number> = {};
    for (let cy = 0; cy < 704; cy++)
      for (let cx = 0; cx < 704; cx++) {
        const k = g.chunkKind(cx, cy)!;
        count[k] = (count[k] ?? 0) + 1;
      }
    for (const k of ['domy', 'przemysl', 'wies', 'las', 'pola', 'woda', 'wojsko'])
      expect(count[k], k).toBeGreaterThan(100);
    expect(count.uslugi).toBeGreaterThan(10);
    expect(Object.keys(count).every((k) => (CHUNK_KINDS as readonly string[]).includes(k))).toBe(
      true,
    );
    const names = g.places().map((p) => p.name);
    expect(names).toContain('Centrum');
    expect(names).toContain('Pławo');
  });

  it('a far chunk waits for its tiles, then has buildings', async () => {
    const g = tiles.generator;
    const p = g.places().find((q) => q.name === 'Pławo')!;
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cy = Math.floor(p.y / CHUNK_SIZE);
    expect(tiles.ready(cx, cy)).toBe(false);
    await tiles.ensure(cx, cy);
    expect(tiles.ready(cx, cy)).toBe(true);
    let walls = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const col = g.column(cx + dx, cy + dy)!;
        walls += col.levels[0]!.edgeN.reduce((a, e) => a + (e ? 1 : 0), 0);
      }
    expect(walls).toBeGreaterThan(50);
  }, 60_000);

  it('woods and scrub give the sim cover zones (bushes / cover, #209)', async () => {
    const g = tiles.generator;
    const s = g.start();
    const sx = Math.floor(s.x / CHUNK_SIZE);
    const sy = Math.floor(s.y / CHUNK_SIZE);
    // The nearest woods chunk („las”) to the start.
    let best: [number, number] | undefined;
    for (let r = 1; r < 120 && !best; r++)
      for (let dy = -r; dy <= r && !best; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (
            Math.max(Math.abs(dx), Math.abs(dy)) === r &&
            g.chunkKind(sx + dx, sy + dy) === 'las'
          ) {
            best = [sx + dx, sy + dy];
            break;
          }
    const [cx, cy] = best!;
    await tiles.ensure(cx, cy);
    const world = generatorWorldSource(g, 48, tiles);
    const zonesOf = (x: number, y: number) => world.getChunk(x, y, 0)?.zones ?? [];
    const cover = zonesOf(cx, cy);
    expect(cover.map((zn) => zn.role)).toContain('cover');
    for (const zn of cover) {
      expect(zn.id.startsWith(`cover:${cx},${cy}:`)).toBe(true);
      for (const r of zn.rects) {
        expect(r.x).toBeGreaterThanOrEqual(cx * CHUNK_SIZE);
        expect(r.y).toBeGreaterThanOrEqual(cy * CHUNK_SIZE);
        expect(r.x + r.w).toBeLessThanOrEqual((cx + 1) * CHUNK_SIZE);
        expect(r.y + r.h).toBeLessThanOrEqual((cy + 1) * CHUNK_SIZE);
      }
    }
    // Scrub and hedges (bushes) somewhere around the start.
    let bushes = 0;
    for (let dy = -6; dy <= 6 && bushes === 0; dy++)
      for (let dx = -6; dx <= 6 && bushes === 0; dx++)
        bushes = zonesOf(sx + dx * 4, sy + dy * 4).filter((zn) => zn.role === 'bushes').length;
    expect(bushes).toBeGreaterThan(0);
  }, 120_000);

  it('HV towers and catenary masts block movement at their feet, never on a road or track', async () => {
    const g = tiles.generator;
    await tiles.ensureAll();
    const world = generatorWorldSource(g, 48, tiles);
    const bad = new Set(['base:asphalt'].map((id) => TILE_PALETTE.indexOf(id)));
    /** Distance from (x, y) to the nearest rail axis (track bed = within the model's half width). */
    const railDist = (x: number, y: number) => {
      let best = Infinity;
      for (const r of g.index.rails.items)
        for (let k = 0; k + 3 < r.pts.length; k += 2) {
          const [ax, ay] = [r.pts[k]!, r.pts[k + 1]!];
          if (Math.abs(ax - x) > 400 && Math.abs(r.pts[k + 2]! - x) > 400) continue;
          const dx = r.pts[k + 2]! - ax;
          const dy = r.pts[k + 3]! - ay;
          const t = Math.max(
            0,
            Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
          );
          best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
        }
      return best;
    };
    let towers = 0;
    let masts = 0;
    let bareMasts = 0;
    const bareTowers: string[] = [];
    const issues: string[] = [];
    // Chunks under HV towers (line vertices) and along electrified track (every ~50 m).
    const cand = new Map<string, [number, number]>();
    const add = (x: number, y: number) => {
      const c: [number, number] = [Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)];
      cand.set(c.join(','), c);
    };
    for (const w of g.index.power.items)
      if (w.kind !== 'lv')
        for (let i = 0; i + 1 < w.pts.length; i += 2) add(w.pts[i]!, w.pts[i + 1]!);
    for (const r of g.index.rails.items) {
      if (!r.el) continue;
      for (let i = 2; i + 1 < r.pts.length; i += 2) {
        const [ax, ay, bx, by] = [r.pts[i - 2]!, r.pts[i - 1]!, r.pts[i]!, r.pts[i + 1]!];
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 50);
        for (let k = 0; k <= n; k++) add(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
      }
    }
    for (const [cx, cy] of cand.values()) {
      const col = g.column(cx, cy);
      const poles = (col?.infra?.poles ?? []).filter((p) => /^(hv|catenary-mast)/.test(p.m));
      if (!poles.length) continue;
      const sc = world.getChunk(cx, cy, 0)!;
      const bl = sc.blockers ?? [];
      for (const p of poles) {
        const lx = p.x - cx * CHUNK_SIZE;
        const ly = p.y - cy * CHUNK_SIZE;
        const reach = p.m === 'hv400-portal' ? 9 : p.m.startsWith('hv') ? 4.5 : 1;
        const has = bl.some(
          (b) => b.x1 > lx - reach && b.x0 < lx + reach && b.y1 > ly - reach && b.y0 < ly + reach,
        );
        if (p.m.startsWith('hv')) {
          towers++;
          // OSM puts a few towers right over a road: all legs on asphalt / track, no blocker.
          if (!has) bareTowers.push(`${p.m} at ${p.x},${p.y}`);
        } else {
          masts++;
          // A mast between tracks (its plate on track ground) has no blocker.
          if (!has) bareMasts++;
        }
      }
      for (const b of bl) {
        const wx = cx * CHUNK_SIZE + (b.x0 + b.x1) / 2;
        const wy = cy * CHUNK_SIZE + (b.y0 + b.y1) / 2;
        if (railDist(wx, wy) < 2.3) issues.push(`blocker on the track bed at ${wx},${wy}`);
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.y1).toBeLessThanOrEqual(CHUNK_SIZE);
        expect(b.x0).toBeLessThan(b.x1);
        for (let y = Math.floor(b.y0); y < Math.ceil(b.y1); y++)
          for (let x = Math.floor(b.x0); x < Math.ceil(b.x1); x++)
            if (bad.has(sc.floor[y * CHUNK_SIZE + x]!))
              issues.push(`blocker on a road at ${cx * CHUNK_SIZE + x},${cy * CHUNK_SIZE + y}`);
      }
    }
    expect(towers).toBeGreaterThan(500);
    expect(masts).toBeGreaterThan(500);
    expect(bareMasts / masts).toBeLessThan(0.1);
    expect(bareTowers.length / towers, bareTowers.join('; ')).toBeLessThan(0.01);
    console.log(`towers ${towers} (bare ${bareTowers.length}), masts ${masts} (bare ${bareMasts})`);
    expect(issues.slice(0, 20)).toEqual([]);
  }, 1_800_000);

  it('HV lines run in clearings: no trees or woods cover in the strip (przecinki)', async () => {
    const g = tiles.generator;
    await tiles.ensureAll();
    const world = generatorWorldSource(g, 48, tiles);
    const W = { hv110: 30, hv220: 40, hv400: 60 } as const;
    const issues: string[] = [];
    let checked = 0;
    for (const w of g.index.power.items) {
      if (w.kind === 'lv') continue;
      const h = W[w.kind] / 2;
      /** Distance to this line's axis. */
      const dist = (x: number, y: number) => {
        let best = Infinity;
        for (let k = 0; k + 3 < w.pts.length; k += 2) {
          const [ax, ay, dx, dy] = [
            w.pts[k]!,
            w.pts[k + 1]!,
            w.pts[k + 2]! - w.pts[k]!,
            w.pts[k + 3]! - w.pts[k + 1]!,
          ];
          const t = Math.max(
            0,
            Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
          );
          best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
        }
        return best;
      };
      // Every 4th segment midpoint: its chunk.
      for (let k = 0; k + 3 < w.pts.length; k += 8) {
        const cx = Math.floor((w.pts[k]! + w.pts[k + 2]!) / 2 / CHUNK_SIZE);
        const cy = Math.floor((w.pts[k + 1]! + w.pts[k + 3]!) / 2 / CHUNK_SIZE);
        const col = g.column(cx, cy);
        if (!col) continue;
        checked++;
        const X0 = cx * CHUNK_SIZE;
        const Y0 = cy * CHUNK_SIZE;
        for (let i = 0; i + 1 < col.trees.length; i += 2) {
          const d = dist(X0 + col.trees[i]!, Y0 + col.trees[i + 1]!);
          if (d < h - 1)
            issues.push(
              `${w.kind} tree ${d.toFixed(1)} m from the line at ${X0 + col.trees[i]!},${Y0 + col.trees[i + 1]!}`,
            );
        }
        for (const zn of world.getChunk(cx, cy, 0)?.zones ?? []) {
          if (zn.role !== 'cover') continue;
          for (const r of zn.rects)
            for (let y = r.y; y < r.y + r.h; y++)
              for (let x = r.x; x < r.x + r.w; x++)
                if (dist(x + 0.5, y + 0.5) < h - 1)
                  issues.push(`${w.kind} woods cover at ${x},${y}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(issues.slice(0, 20)).toEqual([]);
  }, 1_800_000);
});
