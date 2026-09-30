/** xxHash32 (reference algorithm) plus a small writer for canonical state serialization. */
const P1 = 0x9e3779b1;
const P2 = 0x85ebca77;
const P3 = 0xc2b2ae3d;
const P4 = 0x27d4eb2f;
const P5 = 0x165667b1;

const rotl = (x: number, r: number): number => (x << r) | (x >>> (32 - r));

function readU32(b: Uint8Array, i: number): number {
  return (
    ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0
  );
}

export function xxhash32(bytes: Uint8Array, seed = 0): number {
  const len = bytes.length;
  let i = 0;
  let h: number;
  if (len >= 16) {
    let v1 = (seed + P1 + P2) | 0;
    let v2 = (seed + P2) | 0;
    let v3 = seed | 0;
    let v4 = (seed - P1) | 0;
    const round = (v: number, input: number): number =>
      Math.imul(rotl((v + Math.imul(input, P2)) | 0, 13), P1);
    while (i <= len - 16) {
      v1 = round(v1, readU32(bytes, i));
      v2 = round(v2, readU32(bytes, i + 4));
      v3 = round(v3, readU32(bytes, i + 8));
      v4 = round(v4, readU32(bytes, i + 12));
      i += 16;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0;
  } else {
    h = (seed + P5) | 0;
  }
  h = (h + len) | 0;
  while (i <= len - 4) {
    h = Math.imul(rotl((h + Math.imul(readU32(bytes, i), P3)) | 0, 17), P4);
    i += 4;
  }
  while (i < len) {
    h = Math.imul(rotl((h + Math.imul(bytes[i] ?? 0, P5)) | 0, 11), P1);
    i++;
  }
  h = Math.imul(h ^ (h >>> 15), P2);
  h = Math.imul(h ^ (h >>> 13), P3);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Appends little-endian words to a growable buffer; floats are written as their f32 bits. */
export class HashWriter {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  private len = 0;

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + extra));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.len, v >>> 0, true);
    this.len += 4;
    return this;
  }

  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.len, v, true);
    this.len += 4;
    return this;
  }

  bytes(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }

  digest(seed = 0): number {
    return xxhash32(this.bytes(), seed);
  }
}
