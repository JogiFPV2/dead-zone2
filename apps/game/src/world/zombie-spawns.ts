import { CHUNK_SIZE, type SimMapData, type SimZombieSpawn } from '@deadzone/protocol';

/** Zombies placed at the start of a content map (test build: ~40 around the town). */
export const START_ZOMBIES = 40;
/** No zombie closer than this to the player spawn (tiles). */
export const SAFE_RADIUS = 18;

/**
 * Deterministic zombie spawn points: outdoor floor tiles (no room) with no wall on any edge,
 * at least SAFE_RADIUS from the start, picked with a seeded LCG.
 */
export function pickZombieSpawns(
  map: SimMapData,
  start: { x: number; y: number },
  count = START_ZOMBIES,
  seed = 1,
): SimZombieSpawn[] {
  const byKey = new Map(map.chunks.filter((c) => c.z === 0).map((c) => [`${c.cx},${c.cy}`, c]));
  const at = (tx: number, ty: number) => {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    const c = byKey.get(`${cx},${cy}`);
    return c ? { c, i: (ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE) } : undefined;
  };
  const free = (tx: number, ty: number): boolean => {
    const t = at(tx, ty);
    if (!t || (t.c.floor[t.i] ?? 0) <= 0 || (t.c.room?.[t.i] ?? 0) > 0) return false;
    if ((t.c.edgeN[t.i] ?? 0) > 0 || (t.c.edgeW[t.i] ?? 0) > 0) return false;
    const s = at(tx, ty + 1);
    const e = at(tx + 1, ty);
    return !!s && !!e && (s.c.edgeN[s.i] ?? 0) === 0 && (e.c.edgeW[e.i] ?? 0) === 0;
  };
  const candidates: { x: number; y: number }[] = [];
  for (const c of byKey.values()) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tx = c.cx * CHUNK_SIZE + lx;
        const ty = c.cy * CHUNK_SIZE + ly;
        const x = tx + 0.5;
        const y = ty + 0.5;
        if (Math.hypot(x - start.x, y - start.y) < SAFE_RADIUS) continue;
        if (free(tx, ty)) candidates.push({ x, y });
      }
    }
  }
  candidates.sort((a, b) => a.y - b.y || a.x - b.x);
  let state = seed >>> 0 || 1;
  const out: SimZombieSpawn[] = [];
  for (let n = 0; n < count && candidates.length; n++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const [p] = candidates.splice(state % candidates.length, 1);
    if (p) out.push({ x: p.x, y: p.y });
  }
  return out;
}
