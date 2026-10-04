import { CHUNK_SIZE, STAIR_STEP, decodeLayer, type MapChunkJson } from '@deadzone/content';

/**
 * Walkability check of a built map: from every room tile with a floor on every storey, can you
 * walk out to an outdoor tile of level 0? Doors and gates pass, walls, windows and fences do not;
 * a flight joins the tile before its bottom step (level z) with the tile past its top step
 * (level z + 1); flight tiles and stair openings are not walked on directly. Furniture is ignored
 * (the furnisher keeps every room's free tiles connected and both sides of each door free).
 */
export function unreachableRoomTiles(
  chunks: readonly MapChunkJson[],
): { x: number; y: number; z: number }[] {
  const byKey = new Map(chunks.map((c) => [`${c.address.cx},${c.address.cy},${c.address.z}`, c]));
  const dec = new Map<
    MapChunkJson,
    { floor: Uint16Array; room?: Uint16Array; block: Set<string> }
  >();
  const info = (c: MapChunkJson) => {
    let d = dec.get(c);
    if (!d) {
      const block = new Set<string>();
      for (const e of c.edges ?? [])
        if (e.type === 'wall' || e.type === 'window' || e.type === 'fence')
          block.add(`${e.x},${e.y},${e.side}`);
      d = {
        floor: decodeLayer(c.layers.floor),
        ...(c.layers.room ? { room: decodeLayer(c.layers.room) } : {}),
        block,
      };
      dec.set(c, d);
    }
    return d;
  };
  const at = (x: number, y: number, z: number) => {
    const cx = Math.floor(x / CHUNK_SIZE),
      cy = Math.floor(y / CHUNK_SIZE);
    const c = byKey.get(`${cx},${cy},${z}`);
    if (!c) return undefined;
    const d = info(c);
    const i = (y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE);
    return {
      floor: d.floor[i] ?? 0,
      room: d.room?.[i] ?? 0,
      d,
      lx: x - cx * CHUNK_SIZE,
      ly: y - cy * CHUNK_SIZE,
    };
  };
  // Blocking edge on the north side of (x, y) / west side.
  const blockedN = (x: number, y: number, z: number) => {
    const t = at(x, y, z);
    return !!t && t.d.block.has(`${t.lx},${t.ly},n`);
  };
  const blockedW = (x: number, y: number, z: number) => {
    const t = at(x, y, z);
    return !!t && t.d.block.has(`${t.lx},${t.ly},w`);
  };
  const stairTiles = new Set<string>();
  const links: [string, string][] = [];
  for (const c of chunks) {
    for (const s of c.stairs ?? []) {
      const [dx, dy] = STAIR_STEP[s.dir];
      const x = c.address.cx * CHUNK_SIZE + s.tx;
      const y = c.address.cy * CHUNK_SIZE + s.ty;
      const z = c.address.z;
      for (let k = 0; k < s.len; k++) stairTiles.add(`${x + dx * k},${y + dy * k},${z}`);
      links.push([`${x - dx},${y - dy},${z}`, `${x + dx * s.len},${y + dy * s.len},${z + 1}`]);
    }
  }
  const walk = (x: number, y: number, z: number) => {
    if (stairTiles.has(`${x},${y},${z}`)) return false;
    const t = at(x, y, z);
    return !!t && t.floor > 0;
  };
  const seen = new Set<string>();
  const q: [number, number, number][] = [];
  const push = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    if (seen.has(k) || !walk(x, y, z)) return;
    seen.add(k);
    q.push([x, y, z]);
  };
  const linkMap = new Map<string, string[]>();
  for (const [a, b] of links) {
    linkMap.set(a, [...(linkMap.get(a) ?? []), b]);
    linkMap.set(b, [...(linkMap.get(b) ?? []), a]);
  }
  for (const c of chunks) {
    if (c.address.z !== 0) continue;
    for (let ly = 0; ly < CHUNK_SIZE; ly++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = c.address.cx * CHUNK_SIZE + lx,
          y = c.address.cy * CHUNK_SIZE + ly;
        const t = at(x, y, 0)!;
        if (t.floor > 0 && t.room === 0) push(x, y, 0);
      }
  }
  for (let h = 0; h < q.length; h++) {
    const [x, y, z] = q[h]!;
    if (!blockedN(x, y, z)) push(x, y - 1, z);
    if (!blockedN(x, y + 1, z)) push(x, y + 1, z);
    if (!blockedW(x, y, z)) push(x - 1, y, z);
    if (!blockedW(x + 1, y, z)) push(x + 1, y, z);
    for (const o of linkMap.get(`${x},${y},${z}`) ?? []) {
      const [a, b, cz] = o.split(',').map(Number) as [number, number, number];
      push(a, b, cz);
    }
  }
  const out: { x: number; y: number; z: number }[] = [];
  for (const c of chunks)
    for (let ly = 0; ly < CHUNK_SIZE; ly++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = c.address.cx * CHUNK_SIZE + lx,
          y = c.address.cy * CHUNK_SIZE + ly,
          z = c.address.z;
        const t = at(x, y, z)!;
        if (t.room > 0 && walk(x, y, z) && !seen.has(`${x},${y},${z}`)) out.push({ x, y, z });
      }
  return out;
}
