/**
 * Dense-cover zones of a chunk for the sim (#209: `COVER_ZONES` = zone role / id / tag `bushes`
 * or `cover`; zombies lose the track faster there, `base:scatter-bushes` loot lies in `bushes`).
 * From the OSM vegetation the generator draws: scrub, heath, hedges (`barrier=hedge`, thin scrub
 * strips) → `bushes`; woods and groves (`natural=wood`, `landuse=forest`, copses) → `cover`.
 * Only open ground (grass / dirt), never under a building, a road or a bridge deck.
 */

/** Zone of one chunk: a union of chunk-local tile rectangles (x, y, w, h). */
export interface GenCoverZone {
  role: 'bushes' | 'cover';
  rects: { x: number; y: number; w: number; h: number }[];
}

/**
 * Greedy rectangles covering exactly the set tiles of a C×C mask: runs per row, a run grows down
 * while the next row has the same run. Deterministic, row-major.
 */
export function maskRects(
  mask: Uint8Array,
  C: number,
): { x: number; y: number; w: number; h: number }[] {
  const done = new Uint8Array(C * C);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      const i = y * C + x;
      if (!mask[i] || done[i]) continue;
      let w = 1;
      while (x + w < C && mask[i + w] && !done[i + w]) w++;
      let h = 1;
      grow: while (y + h < C) {
        const row = (y + h) * C + x;
        if (x > 0 && mask[row - 1] && !done[row - 1]) break;
        if (x + w < C && mask[row + w] && !done[row + w]) break;
        for (let k = 0; k < w; k++) if (!mask[row + k] || done[row + k]) break grow;
        h++;
      }
      for (let dy = 0; dy < h; dy++) done.fill(1, (y + dy) * C + x, (y + dy) * C + x + w);
      out.push({ x, y, w, h });
    }
  return out;
}

/** Cover zones from per-tile classes (0 none, 1 bushes, 2 cover) of a C×C chunk. */
export function coverZones(cls: Uint8Array, C: number): GenCoverZone[] {
  const out: GenCoverZone[] = [];
  for (const [v, role] of [
    [1, 'bushes'],
    [2, 'cover'],
  ] as const) {
    const mask = new Uint8Array(C * C);
    let any = false;
    for (let i = 0; i < C * C; i++)
      if (cls[i] === v) {
        mask[i] = 1;
        any = true;
      }
    if (any) out.push({ role, rects: maskRects(mask, C) });
  }
  return out;
}
