import { Box3, Vector3, type BufferGeometry } from 'three';

/** Box of the triangles of `g` whose uv falls in atlas cell `uv` (e.g. the glass), or empty. */
export function cellBox(g: BufferGeometry, uv: [number, number], cellSize = 1 / 16): Box3 {
  const pos = g.getAttribute('position');
  const tex = g.getAttribute('uv');
  const box = new Box3();
  if (!pos || !tex) return box;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const at = (k: number) => (idx ? idx.getX(k) : k);
  const inCell = (i: number) =>
    Math.abs(tex.getX(i) - uv[0]) < cellSize / 2 && Math.abs(tex.getY(i) - uv[1]) < cellSize / 2;
  const p = new Vector3();
  for (let t = 0; t + 2 < n; t += 3) {
    const a = at(t),
      b = at(t + 1),
      c = at(t + 2);
    if (!(inCell(a) && inCell(b) && inCell(c))) continue;
    for (const v of [a, b, c]) box.expandByPoint(p.fromBufferAttribute(pos, v));
  }
  return box;
}
