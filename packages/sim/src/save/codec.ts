import { Rng } from '../core/rng.js';

/**
 * Lossless JSON codec for sim state (save games): typed arrays as base64 of their bytes (exact
 * f32 bits, including −0 and NaN), Maps, Sets, non-finite numbers and `Rng` instances tagged.
 * Plain objects and arrays are walked recursively. Class instances other than `Rng` are not
 * supported (callers exclude them).
 */
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const TYPED = {
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Uint8ClampedArray,
} as const;
type TypedName = keyof typeof TYPED;
export type AnyTyped = InstanceType<(typeof TYPED)[TypedName]>;

export const isTyped = (v: unknown): v is AnyTyped =>
  ArrayBuffer.isView(v) && !(v instanceof DataView);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) B64_INV[B64.charCodeAt(i)] = i;

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n =
      (B64_INV[s.charCodeAt(i)]! << 18) |
      (B64_INV[s.charCodeAt(i + 1)]! << 12) |
      (B64_INV[s.charCodeAt(i + 2)]! << 6) |
      B64_INV[s.charCodeAt(i + 3)]!;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

function typedName(v: AnyTyped): TypedName {
  for (const name of Object.keys(TYPED) as TypedName[]) if (v instanceof TYPED[name]) return name;
  throw new Error('unsupported typed array');
}

/** Encodes a typed array; `len` (elements) trims it, e.g. to the used entity range. */
export function encodeTyped(v: AnyTyped, len = v.length): Json {
  const n = Math.min(len, v.length);
  const bytes = new Uint8Array(v.buffer, v.byteOffset, n * v.BYTES_PER_ELEMENT);
  return { $t: typedName(v), b: toBase64(bytes) };
}

export function encode(v: unknown): Json {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : { $f: String(v) };
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (isTyped(v)) return encodeTyped(v);
  if (v instanceof Map) return { $m: [...v.entries()].map(([k, x]) => [encode(k), encode(x)]) };
  if (v instanceof Set) return { $s: [...v].map(encode) };
  if (v instanceof Rng) return { $r: v.state() };
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v) as unknown;
    if (proto !== Object.prototype && proto !== null)
      throw new Error(`save: unsupported class ${String(v.constructor?.name)}`);
    const out: { [k: string]: Json } = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = encode(x);
    return out;
  }
  throw new Error(`save: unsupported value ${typeof v}`);
}

export function decode(j: unknown): unknown {
  if (j === null || typeof j !== 'object') return j;
  if (Array.isArray(j)) return j.map(decode);
  const o = j as Record<string, unknown>;
  if ('$f' in o) return Number(o.$f);
  if ('$t' in o) {
    const bytes = fromBase64(o.b as string);
    const Ctor = TYPED[o.$t as TypedName];
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new Ctor(copy.buffer, 0, bytes.length / Ctor.BYTES_PER_ELEMENT);
  }
  if ('$m' in o)
    return new Map((o.$m as [unknown, unknown][]).map(([k, x]) => [decode(k), decode(x)]));
  if ('$s' in o) return new Set((o.$s as unknown[]).map(decode));
  if ('$r' in o) return new Rng(o.$r as [number, number, number, number]);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = decode(x);
  return out;
}

/**
 * Writes decoded `saved` into the live object `target` in place: typed arrays are copied into
 * (prefix), Maps cleared and refilled, other fields assigned. Keys in `skip` are left alone.
 */
export function restoreInto(target: object, saved: unknown, skip: readonly string[] = []): void {
  const t = target as Record<string, unknown>;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (skip.includes(k)) continue;
    const cur = t[k];
    if (isTyped(cur) && isTyped(v)) {
      cur.fill(0);
      (cur as Uint8Array).set(v);
    } else if (cur instanceof Map && v instanceof Map) {
      cur.clear();
      for (const [mk, mv] of v) cur.set(mk, mv);
    } else if (isPlain(cur) && isPlain(v)) restoreInto(cur, v);
    else t[k] = v;
  }
}

const isPlain = (v: unknown): v is object =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;

/** Encodes the fields of `obj` except `skip`; per-entity typed arrays trimmed to `usedOf`. */
export function encodeFields(
  obj: object,
  skip: readonly string[],
  usedOf: (v: AnyTyped) => number,
): Json {
  const out: { [k: string]: Json } = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip.includes(k) || v === undefined) continue;
    if (isTyped(v)) out[k] = encodeTyped(v, usedOf(v));
    else if (isPlain(v) && Object.values(v).every(isTyped)) out[k] = encodeFields(v, [], usedOf);
    else out[k] = encode(v);
  }
  return out;
}

/** UTF-8 without TextEncoder (not in the sim's lib). */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(b: Uint8Array): string {
  let s = '';
  const cps: number[] = [];
  let i = 0;
  while (i < b.length) {
    const x = b[i]!;
    let c: number;
    let n: number;
    if (x < 0x80) {
      c = x;
      n = 1;
    } else if (x < 0xe0) {
      c = ((x & 31) << 6) | (b[i + 1]! & 63);
      n = 2;
    } else if (x < 0xf0) {
      c = ((x & 15) << 12) | ((b[i + 1]! & 63) << 6) | (b[i + 2]! & 63);
      n = 3;
    } else {
      c = ((x & 7) << 18) | ((b[i + 1]! & 63) << 12) | ((b[i + 2]! & 63) << 6) | (b[i + 3]! & 63);
      n = 4;
    }
    i += n;
    cps.push(c);
    if (cps.length >= 8192) s += String.fromCodePoint(...cps.splice(0));
  }
  return s + String.fromCodePoint(...cps);
}
