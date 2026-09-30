import type { MapZone, ZoneRect } from '@deadzone/content';
import type { Blueprint } from './blueprint.js';

/**
 * Tiles → few rects: horizontal runs per row, then a run is extended downwards while the next row
 * has exactly the same run. Deterministic (sorted by y, then x).
 */
export function tilesToRects(tiles: Iterable<readonly [number, number]>): ZoneRect[] {
  const rows = new Map<number, number[]>();
  for (const [x, y] of tiles) {
    const row = rows.get(y);
    if (row) row.push(x);
    else rows.set(y, [x]);
  }
  const open = new Map<string, ZoneRect>(); // "x,w" → rect ending on the previous row
  const done: ZoneRect[] = [];
  let prevY: number | undefined;
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = [...new Set(rows.get(y))].sort((a, b) => a - b);
    const runs: [number, number][] = [];
    for (const x of xs) {
      const last = runs[runs.length - 1];
      if (last && last[0] + last[1] === x) last[1]++;
      else runs.push([x, 1]);
    }
    const next = new Map<string, ZoneRect>();
    for (const [x, w] of runs) {
      const key = `${x},${w}`;
      const r = prevY === y - 1 ? open.get(key) : undefined;
      if (r) {
        r.h++;
        open.delete(key);
        next.set(key, r);
      } else next.set(key, { x, y, w, h: 1 });
    }
    done.push(...open.values());
    open.clear();
    for (const [k, r] of next) open.set(k, r);
    prevY = y;
  }
  done.push(...open.values());
  return done.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Blueprint zones + ASCII zone plans → manifest `zones` (in blueprint order). */
export function buildZones(bp: Blueprint): MapZone[] {
  const ids = new Set(bp.zones.map((z) => z.id));
  const tiles = new Map<string, [number, number][]>();
  for (const [i, zp] of bp.zonePlans.entries()) {
    for (const id of Object.values(zp.legend)) {
      if (!ids.has(id))
        throw new Error(`zonePlans[${i}]: legenda wskazuje nieznaną strefę „${id}”`);
    }
    zp.plan.forEach((row, py) => {
      [...row].forEach((ch, px) => {
        if (ch === '.' || ch === ' ') return;
        const id = zp.legend[ch];
        if (!id) throw new Error(`zonePlans[${i}]: znak „${ch}” nie ma wpisu w legend`);
        const list = tiles.get(id) ?? [];
        list.push([zp.origin[0] + px, zp.origin[1] + py]);
        tiles.set(id, list);
      });
    });
  }
  return bp.zones.map((z) => ({
    id: z.id,
    role: z.role,
    z: z.z,
    rects: [...z.rects, ...tilesToRects(tiles.get(z.id) ?? [])],
    ...(z.tags ? { tags: z.tags } : {}),
  }));
}
