import { CHUNK_SIZE, PUMP_VIEW_TILES, type PumpView, type SimMapObject } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { floorZ } from '../world/levels.js';
import { pumpReserve, pumpSource } from './fuel.js';
import { vehicleSettings } from './settings.js';

/** Local tiles of pump objects per chunk object list (map objects do not change). */
const pumpTiles = new WeakMap<readonly SimMapObject[], { id: string; tiles: [number, number][] }>();

function pumpsOf(objects: readonly SimMapObject[], id: string): [number, number][] {
  const hit = pumpTiles.get(objects);
  if (hit?.id === id) return hit.tiles;
  const tiles: [number, number][] = [];
  for (const o of objects) if (o.contentId === id) tiles.push([o.x, o.y]);
  pumpTiles.set(objects, { id, tiles });
  return tiles;
}

/**
 * Fuel pumps within `PUMP_VIEW_TILES` of player `eid` on its floor (`SimViewPatch.pumps`):
 * stock (the deterministic first-use roll until the pump is used), power or crank and the rate.
 * Sorted by (y, x).
 */
export function pumpViews(w: SimWorld, eid: number): PumpView[] {
  if (!w.items) return [];
  const cfg = vehicleSettings(w).fuel;
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const r = PUMP_VIEW_TILES;
  const source = pumpSource(w);
  const lps = source === 'power' ? cfg.pumpPoweredLps : cfg.pumpManualLps;
  const out: PumpView[] = [];
  const cx0 = Math.floor((px - r) / CHUNK_SIZE);
  const cx1 = Math.floor((px + r) / CHUNK_SIZE);
  const cy0 = Math.floor((py - r) / CHUNK_SIZE);
  const cy1 = Math.floor((py + r) / CHUNK_SIZE);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const objects = w.map.getChunk(cx, cy, z)?.objects;
      if (!objects?.length) continue;
      for (const [lx, ly] of pumpsOf(objects, cfg.pumpItem)) {
        const x = cx * CHUNK_SIZE + lx;
        const y = cy * CHUNK_SIZE + ly;
        if ((x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 > r * r) continue;
        const stockL = Math.round(pumpReserve(w, x, y, z) * 10) / 10;
        out.push({ x, y, z, stockL, source, lps });
      }
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}
