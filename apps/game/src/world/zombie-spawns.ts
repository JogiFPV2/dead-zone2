import { CHUNK_SIZE, type SimMapData, type SimZombieSpawn } from '@deadzone/protocol';

/** Zombies placed at the start of a content map (test build: ~40 around the town). */
export const START_ZOMBIES = 40;
/** No zombie closer than this to the player spawn (tiles, same level). */
export const SAFE_RADIUS = 18;
/**
 * Share of the start zombies placed inside buildings (rooms on any floor level) when the map
 * has indoor tiles; the rest stands outdoors on level 0 (PZ: houses are not safe).
 */
export const INDOOR_SHARE = 0.3;

const STAIR_STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;

type Chunk = SimMapData['chunks'][number];

/**
 * Deterministic zombie spawn points (seeded LCG): outdoor floor tiles of level 0 (no room, no
 * wall on any edge) and indoor room tiles on every level the sim has (#82: all floors are
 * simulated). A spawn never stands on a flight of stairs, a stair opening (floor 0) or within
 * SAFE_RADIUS of the start on the start's level.
 */
export function pickZombieSpawns(
  map: SimMapData,
  start: { x: number; y: number; z?: number },
  count = START_ZOMBIES,
  seed = 1,
): SimZombieSpawn[] {
  const byKey = new Map<string, Chunk>(map.chunks.map((c) => [`${c.cx},${c.cy},${c.z}`, c]));
  const at = (tx: number, ty: number, z: number) => {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    const c = byKey.get(`${cx},${cy},${z}`);
    return c ? { c, i: (ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE) } : undefined;
  };
  // Tiles of flights on their own level (no spawn on the steps).
  const stairs = new Set<string>();
  for (const c of map.chunks) {
    for (const st of c.stairs ?? []) {
      const [dx, dy] = STAIR_STEP[st.dir];
      for (let k = 0; k < st.len; k++) {
        stairs.add(
          `${c.cx * CHUNK_SIZE + st.tx + dx * k},${c.cy * CHUNK_SIZE + st.ty + dy * k},${c.z}`,
        );
      }
    }
  }
  const walls = (tx: number, ty: number, z: number): boolean => {
    const t = at(tx, ty, z)!;
    if ((t.c.edgeN[t.i] ?? 0) > 0 || (t.c.edgeW[t.i] ?? 0) > 0) return true;
    const s = at(tx, ty + 1, z);
    const e = at(tx + 1, ty, z);
    return !s || !e || (s.c.edgeN[s.i] ?? 0) !== 0 || (e.c.edgeW[e.i] ?? 0) !== 0;
  };
  const outdoor: { x: number; y: number; z: number }[] = [];
  const indoor: { x: number; y: number; z: number }[] = [];
  const startZ = start.z ?? 0;
  for (const c of map.chunks) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = ly * CHUNK_SIZE + lx;
        if ((c.floor[i] ?? 0) <= 0) continue;
        const tx = c.cx * CHUNK_SIZE + lx;
        const ty = c.cy * CHUNK_SIZE + ly;
        const x = tx + 0.5;
        const y = ty + 0.5;
        if (c.z === startZ && Math.hypot(x - start.x, y - start.y) < SAFE_RADIUS) continue;
        if (stairs.has(`${tx},${ty},${c.z}`)) continue;
        const room = (c.room?.[i] ?? 0) > 0;
        if (room) {
          // Indoors walls are everywhere: only the tile's own edges must be open.
          if ((c.edgeN[i] ?? 0) === 0 && (c.edgeW[i] ?? 0) === 0) indoor.push({ x, y, z: c.z });
        } else if (c.z === 0 && !walls(tx, ty, 0)) outdoor.push({ x, y, z: 0 });
      }
    }
  }
  const order = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    a.z - b.z || a.y - b.y || a.x - b.x;
  outdoor.sort(order);
  indoor.sort(order);
  let state = seed >>> 0 || 1;
  const take = (pool: { x: number; y: number; z: number }[]) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const [p] = pool.splice(state % pool.length, 1);
    return p;
  };
  const wantIndoor = indoor.length > 0 ? Math.round(count * INDOOR_SHARE) : 0;
  const out: SimZombieSpawn[] = [];
  for (let n = 0; n < count; n++) {
    const inside = n < wantIndoor ? indoor : outdoor;
    const pool = inside.length > 0 ? inside : outdoor.length > 0 ? outdoor : indoor;
    if (pool.length === 0) break;
    const p = take(pool);
    if (p) out.push(p.z === 0 ? { x: p.x, y: p.y } : { x: p.x, y: p.y, z: p.z });
  }
  return out;
}
