/* eslint-disable no-restricted-properties, no-restricted-globals -- test-only debug renderer: drawing math and Node file output, never part of the sim. */
/**
 * Headless top-down debug renderer for tests and tools (no dependencies): an RGBA canvas with
 * lines, circles, boxes and a tiny 5-row bitmap font (3 px wide, M / N / W wider), encoded to PNG. `deflate` is optional (node
 * `zlib.deflateSync` when writing files); without it the PNG uses stored deflate blocks.
 */
export type Rgb = readonly [number, number, number];

const GLYPHS: Record<string, string> = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '1000111011101011000110001',
  N: '10011101101110011001',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '1000110001101011101110001',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '110001010100111',
  '3': '110001010001110',
  '4': '101101111001001',
  '5': '111100110001110',
  '6': '011100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001110',
  ' ': '000000000000000',
  '.': '000000000000010',
  ':': '000010000010000',
  '/': '001001010100100',
  '-': '000000111000000',
  '=': '000111000111000',
  '(': '010100100100010',
  ')': '010001001001010',
  '%': '101001010100101',
  ',': '000000000010100',
  '+': '000010111010000',
  '>': '100010001010100',
  '<': '001010100010001',
  '²': '110010100111000',
  '|': '010010010010010',
  '#': '101111101111101',
};

export class Canvas {
  readonly px: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    bg: Rgb = [24, 26, 30],
  ) {
    this.px = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.px[i * 4] = bg[0];
      this.px[i * 4 + 1] = bg[1];
      this.px[i * 4 + 2] = bg[2];
      this.px[i * 4 + 3] = 255;
    }
  }

  dot(x: number, y: number, c: Rgb, a = 1): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
    const o = (iy * this.width + ix) * 4;
    for (let k = 0; k < 3; k++) this.px[o + k] = Math.round(this.px[o + k]! * (1 - a) + c[k]! * a);
  }

  /** Line of width `w` px (round caps). */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb, w = 1, a = 1): void {
    const len = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (w <= 1) this.dot(x, y, c, a);
      else this.disc(x, y, w / 2, c, a);
    }
  }

  disc(cx: number, cy: number, r: number, c: Rgb, a = 1): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.dot(x, y, c, a);
  }

  ring(cx: number, cy: number, r: number, c: Rgb, w = 1): void {
    const n = Math.max(16, Math.ceil(r * 6));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      this.line(
        cx + Math.cos(a0) * r,
        cy + Math.sin(a0) * r,
        cx + Math.cos(a1) * r,
        cy + Math.sin(a1) * r,
        c,
        w,
      );
    }
  }

  rect(x: number, y: number, w: number, h: number, c: Rgb, a = 1): void {
    for (let yy = Math.floor(y); yy < y + h; yy++)
      for (let xx = Math.floor(x); xx < x + w; xx++) this.dot(xx, yy, c, a);
  }

  /** Polygon outline (closed). */
  poly(pts: readonly (readonly [number, number])[], c: Rgb, w = 1): void {
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[(i + 1) % pts.length]!;
      this.line(x0, y0, x1, y1, c, w);
    }
  }

  arrow(x0: number, y0: number, x1: number, y1: number, c: Rgb, w = 2): void {
    this.line(x0, y0, x1, y1, c, w);
    const a = Math.atan2(y1 - y0, x1 - x0);
    const h = 6 + w * 2;
    this.line(x1, y1, x1 - Math.cos(a - 0.5) * h, y1 - Math.sin(a - 0.5) * h, c, w);
    this.line(x1, y1, x1 - Math.cos(a + 0.5) * h, y1 - Math.sin(a + 0.5) * h, c, w);
  }

  /** Text (upper-cased) with the bitmap font scaled by `s`; returns the width in px. */
  text(x: number, y: number, str: string, c: Rgb, s = 2): number {
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const g = GLYPHS[ch] ?? GLYPHS['#']!;
      const gw = g.length / 5;
      for (let r = 0; r < 5; r++)
        for (let k = 0; k < gw; k++)
          if (g[r * gw + k] === '1') this.rect(cx + k * s, y + r * s, s, s, c);
      cx += (gw + 1) * s;
    }
    return cx - x;
  }

  png(deflate?: (raw: Uint8Array) => Uint8Array): Uint8Array {
    return encodePng(this.width, this.height, this.px, deflate);
  }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** zlib stream with stored (uncompressed) deflate blocks. */
function storedZlib(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = part.length & 0xff;
    out[o++] = part.length >>> 8;
    out[o++] = ~part.length & 0xff;
    out[o++] = (~part.length >>> 8) & 0xff;
    out.set(part, o);
    o += part.length;
  }
  let a = 1;
  let b = 0;
  for (const x of raw) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  const ad = ((b << 16) | a) >>> 0;
  out[o] = ad >>> 24;
  out[o + 1] = (ad >>> 16) & 0xff;
  out[o + 2] = (ad >>> 8) & 0xff;
  out[o + 3] = ad & 0xff;
  return out;
}

export function encodePng(
  w: number,
  h: number,
  rgba: Uint8Array,
  deflate: (raw: Uint8Array) => Uint8Array = storedZlib,
): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const chunks: Uint8Array[] = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])];
  const chunk = (type: string, data: Uint8Array) => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length)));
    chunks.push(c);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  chunk('IHDR', ihdr);
  chunk('IDAT', deflate(raw));
  chunk('IEND', new Uint8Array(0));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Writes `bytes` to `path` when running under Node (tests only); returns false otherwise. */
export async function writeFileIfNode(path: string, bytes: Uint8Array): Promise<boolean> {
  const g = globalThis as unknown as { process?: { versions?: { node?: string } } };
  if (!g.process?.versions?.node) return false;
  const mod = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as {
    mkdirSync(p: string, o: { recursive: boolean }): void;
    writeFileSync(p: string, b: Uint8Array): void;
  };
  fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(path, bytes);
  return true;
}

/** Node's zlib deflate (level 9) when available, for small PNGs. */
export async function nodeDeflate(): Promise<((raw: Uint8Array) => Uint8Array) | undefined> {
  const g = globalThis as unknown as { process?: { versions?: { node?: string } } };
  if (!g.process?.versions?.node) return undefined;
  const mod = 'node:zlib';
  const z = (await import(/* @vite-ignore */ mod)) as {
    deflateSync(b: Uint8Array, o: { level: number }): Uint8Array;
  };
  return (raw) => new Uint8Array(z.deflateSync(raw, { level: 9 }));
}
