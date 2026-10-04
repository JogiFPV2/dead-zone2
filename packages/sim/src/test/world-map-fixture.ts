/**
 * Zone kinds of the 8 × 8 km world layout (`dz-html/worldmap/world-map.json`, condensed; metres,
 * (0, 0) = NW): town ellipses (centre → `centrum`, ring → `uslugi` / `bloki` / `przemysl`, rest →
 * `domy`), villages (`wies`), farms (`farma`), the lake (`woda`), forests (`las`), else `pola`.
 * Used to calibrate `simLod.zombiesPerChunk`; the real kinds come from the generator.
 */
const TOWNS = [
  { c: [5000, 4300], rx: 850, ry: 700, ring: 'bloki' },
  { c: [1800, 5900], rx: 520, ry: 430, ring: 'uslugi' },
  { c: [6900, 5900], rx: 380, ry: 300, ring: 'przemysl' },
] as const;
const VILLAGES = [
  [1250, 7350],
  [4400, 6850],
  [1500, 2050],
  [6600, 1250],
] as const;
const FARMS = [
  [3300, 6400],
  [2600, 1900],
  [900, 4500],
  [3500, 2200],
  [6300, 6400],
  [7600, 4300],
  [5900, 2600],
  [2700, 7600],
  [4300, 2900],
  [7300, 2400],
  [600, 6400],
] as const;
const FORESTS = [
  [4800, 700, 1500],
  [6900, 1300, 900],
  [2600, 900, 900],
  [500, 2400, 800],
  [700, 3700, 600],
  [7000, 7300, 1000],
  [5900, 7700, 700],
  [300, 7700, 500],
  [3400, 5900, 380],
  [7600, 4200, 500],
  [1300, 1200, 500],
  [6100, 3000, 350],
] as const;

/** 8192 m / 32 m. */
export const WORLD_CHUNKS = 256;
/** Lipowiec (start town) centre in chunks. */
export const START_CHUNK = { cx: Math.floor(1800 / 32), cy: Math.floor(5900 / 32) };

export function worldMapKind(cx: number, cy: number): string {
  const x = cx * 32 + 16;
  const y = cy * 32 + 16;
  for (const t of TOWNS) {
    const d = ((x - t.c[0]) / t.rx) ** 2 + ((y - t.c[1]) / t.ry) ** 2;
    if (d < 0.08) return 'centrum';
    if (d < 0.3) return t.ring;
    if (d < 1) return 'domy';
  }
  for (const [vx, vy] of VILLAGES) if ((x - vx) ** 2 + (y - vy) ** 2 < 250 ** 2) return 'wies';
  for (const [fx, fy] of FARMS) if ((x - fx) ** 2 + (y - fy) ** 2 < 60 ** 2) return 'farma';
  if (((x - 2350) / 650) ** 2 + ((y - 3350) / 500) ** 2 < 1) return 'woda';
  for (const [fx, fy, r] of FORESTS) if ((x - fx) ** 2 + (y - fy) ** 2 < r * r) return 'las';
  return 'pola';
}

interface GzipHost {
  CompressionStream: new (format: 'gzip') => unknown;
  Response: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
  Blob: new (parts: unknown[]) => { stream(): { pipeThrough(t: unknown): unknown } };
}

/** gzip size of `bytes` (host `CompressionStream`; the sim itself never uses it). */
export async function gzipSize(bytes: Uint8Array): Promise<number> {
  // eslint-disable-next-line no-restricted-globals -- test-only host API (save size budget)
  const g = globalThis as unknown as GzipHost;
  const stream = new g.Blob([bytes]).stream().pipeThrough(new g.CompressionStream('gzip'));
  return (await new g.Response(stream).arrayBuffer()).byteLength;
}

/** Prints a measurement line to stderr (tests only). */
export function testLog(line: string): void {
  // eslint-disable-next-line no-restricted-globals -- test output
  const g = globalThis as unknown as { process: { stderr: { write(s: string): void } } };
  g.process.stderr.write(line);
}
