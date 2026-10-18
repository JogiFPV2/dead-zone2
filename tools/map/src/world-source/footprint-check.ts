import { CHUNK_SIZE } from '@deadzone/content';
import { occupiedTiles, type Footprint } from '@deadzone/content/footprint';
import type { GenColumn } from './generator.js';
import { EDGE_PALETTE } from './palette.js';

const C = CHUNK_SIZE;
const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;

/** One footprint problem of generated furniture (see `columnFootprintIssues`). */
export interface ColumnFootprintIssue {
  kind: 'overlap' | 'room' | 'door' | 'stairs';
  at: string;
}

/**
 * Footprint checks over generated chunk columns (world tiles; furniture may cross a chunk edge):
 * - `overlap`: two objects cover one tile,
 * - `room`: indoor furniture covers a tile outside a room, of another building or room type, or
 *   with a wall / window / door between two of its tiles (= another room); an outdoor prop
 *   reaches into a room,
 * - `door`: a covered tile is a door tile or the tile in front of it (both sides),
 * - `stairs`: a covered tile is a stair run, its foot or its landing.
 * Tiles in chunks outside `cols` are not judged (only covers inside the sample).
 */
export function columnFootprintIssues(
  cols: readonly GenColumn[],
  footprint: (contentId: string) => Footprint,
): ColumnFootprintIssue[] {
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  /** World tile → [room type, building gid] (absent = no room), edges, per level. */
  const room = new Map<string, string>();
  const edge = new Map<string, string>();
  const known = new Set<string>();
  const doors = new Set<string>();
  const stairs = new Set<string>();
  for (const c of cols)
    for (const l of c.levels) {
      known.add(`${c.cx},${c.cy},${l.z}`);
      const meta = new Map(l.rooms.map(([id, type, gid]) => [id, `${type}#${gid}`]));
      for (let i = 0; i < C * C; i++) {
        const x = c.cx * C + (i % C);
        const y = c.cy * C + ((i / C) | 0);
        const r = l.room?.[i] ?? 0;
        if (r) room.set(k(x, y, l.z), meta.get(r)!);
        const n = EDGE_PALETTE[l.edgeN[i]!]?.kind;
        const w = EDGE_PALETTE[l.edgeW[i]!]?.kind;
        if (n) edge.set(`${k(x, y, l.z)},n`, n);
        if (w) edge.set(`${k(x, y, l.z)},w`, w);
        if (n === 'door') {
          doors.add(k(x, y, l.z));
          doors.add(k(x, y - 1, l.z));
        }
        if (w === 'door') {
          doors.add(k(x, y, l.z));
          doors.add(k(x - 1, y, l.z));
        }
      }
      for (const s of l.stairs) {
        const [dx, dy] = STEP[s.dir];
        const x = c.cx * C + s.tx;
        const y = c.cy * C + s.ty;
        stairs.add(k(x - dx, y - dy, l.z));
        stairs.add(k(x + dx * s.len, y + dy * s.len, l.z + 1));
        for (let i = 0; i < s.len; i++) {
          stairs.add(k(x + dx * i, y + dy * i, l.z));
          stairs.add(k(x + dx * i, y + dy * i, l.z + 1));
        }
      }
    }
  const inSample = (x: number, y: number, z: number) =>
    known.has(`${Math.floor(x / C)},${Math.floor(y / C)},${z}`);
  /** Edge between neighbouring tiles a and b (4-neighbours). */
  const between = (ax: number, ay: number, bx: number, by: number, z: number) =>
    ax === bx
      ? edge.get(`${k(ax, Math.max(ay, by), z)},n`)
      : edge.get(`${k(Math.max(ax, bx), ay, z)},w`);

  const out: ColumnFootprintIssue[] = [];
  const cover = new Map<string, string>();
  for (const c of cols)
    for (const l of c.levels)
      for (const o of l.objects) {
        const x0 = c.cx * C + o.x;
        const y0 = c.cy * C + o.y;
        const at = `${o.contentId} (${x0}, ${y0}, z ${l.z}, rot ${o.rot})`;
        const home = room.get(k(x0, y0, l.z));
        const tiles = occupiedTiles(x0, y0, o.rot, footprint(o.contentId));
        for (const t of tiles) {
          if (!inSample(t.x, t.y, l.z)) continue;
          const tk = k(t.x, t.y, l.z);
          const prev = cover.get(tk);
          if (prev !== undefined) out.push({ kind: 'overlap', at: `${at} × ${prev} @ ${tk}` });
          else cover.set(tk, at);
          if (room.get(tk) !== home) out.push({ kind: 'room', at: `${at} @ ${tk}` });
          if (doors.has(tk)) out.push({ kind: 'door', at: `${at} @ ${tk}` });
          if (stairs.has(tk)) out.push({ kind: 'stairs', at: `${at} @ ${tk}` });
          for (const u of tiles) {
            if (Math.abs(u.x - t.x) + Math.abs(u.y - t.y) !== 1 || u.x + u.y < t.x + t.y) continue;
            if (!inSample(u.x, u.y, l.z)) continue;
            if (between(t.x, t.y, u.x, u.y, l.z) !== undefined)
              out.push({ kind: 'room', at: `${at}: edge inside @ ${tk}` });
          }
        }
      }
  return out;
}
