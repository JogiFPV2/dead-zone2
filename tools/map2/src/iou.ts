/** IoU of two polygon sets (rings in metres, even-odd) on a raster of `cell` metres. */
export function polygonIou(
  a: readonly (readonly [number, number])[][],
  b: readonly (readonly [number, number])[][],
  cell = 0.1,
): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of [...a, ...b])
    for (const [x, y] of r) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (!Number.isFinite(x0)) return 1;
  const w = Math.ceil((x1 - x0) / cell) + 1;
  const h = Math.ceil((y1 - y0) / cell) + 1;
  const fill = (rs: readonly (readonly [number, number])[][]) => {
    const m = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      const y = y0 + (j + 0.5) * cell;
      const xs: number[] = [];
      for (const r of rs)
        for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
          const [xa, ya] = r[i]!;
          const [xb, yb] = r[k]!;
          if (ya > y !== yb > y) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
        }
      xs.sort((p, q) => p - q);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const i0 = Math.max(0, Math.ceil((xs[s]! - x0) / cell - 0.5));
        const i1 = Math.min(w - 1, Math.floor((xs[s + 1]! - x0) / cell - 0.5));
        for (let i = i0; i <= i1; i++) m[j * w + i] = 1;
      }
    }
    return m;
  };
  const ma = fill(a);
  const mb = fill(b);
  let i = 0;
  let u = 0;
  for (let k = 0; k < ma.length; k++) {
    i += ma[k]! & mb[k]!;
    u += ma[k]! | mb[k]!;
  }
  return u ? i / u : 1;
}
