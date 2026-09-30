import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decodeBase64U16,
  encodeBase64U16,
} from '../schemas/map/codec-base64.js';
import { decodeRle, encodeRle } from '../schemas/map/codec-rle.js';
import { CHUNK_TILES } from '../schemas/map/constants.js';
import { decodeLayer, encodeLayer } from '../schemas/map/layer.js';

/** Deterministyczna „losowa” warstwa z pełnym zakresem uint16. */
function noise(seed = 1): Uint16Array {
  const out = new Uint16Array(CHUNK_TILES);
  let s = seed;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = s >>> 16;
  }
  out[0] = 0;
  out[1] = 0xffff;
  return out;
}

describe('RLE', () => {
  it('koduje odcinki i dekoduje z powrotem', () => {
    const v = new Uint16Array(CHUNK_TILES).fill(1);
    v.fill(3, 100, 110);
    expect(encodeRle(v)).toEqual([
      [1, 100],
      [3, 10],
      [1, 914],
    ]);
    expect(decodeRle(encodeRle(v))).toEqual(v);
    expect(decodeRle(encodeRle(noise()))).toEqual(noise());
  });

  it('odrzuca złą długość, wartości spoza uint16 i puste odcinki', () => {
    expect(() => decodeRle([[1, 1023]])).toThrow(/1023.*1024/);
    expect(() => decodeRle([[65536, 1024]])).toThrow(RangeError);
    expect(() => decodeRle([[-1, 1024]])).toThrow(RangeError);
    expect(() =>
      decodeRle([
        [1, 0],
        [1, 1024],
      ]),
    ).toThrow(RangeError);
    expect(decodeRle([[7, 4]], 4)).toEqual(new Uint16Array([7, 7, 7, 7]));
  });
});

describe('base64 Uint16 (little-endian)', () => {
  it('zgadza się ze znanym wektorem i z dopełnieniem', () => {
    expect(encodeBase64U16(new Uint16Array([1, 2]))).toBe('AQACAA==');
    expect(encodeBase64U16(new Uint16Array([0x0201, 0x0003, 0x0004]))).toBe('AQIDAAQA');
    expect(bytesToBase64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=');
    expect([...base64ToBytes('+/8=')]).toEqual([0xfb, 0xff]);
    expect([...decodeBase64U16('AQACAA==')]).toEqual([1, 2]);
  });

  it('round-trip warstwy 1024 kafli (2048 bajtów)', () => {
    const text = encodeBase64U16(noise(7));
    expect(text).toHaveLength(2732);
    expect(decodeBase64U16(text)).toEqual(noise(7));
  });

  it('odrzuca niepoprawny base64 i nieparzystą liczbę bajtów', () => {
    expect(() => base64ToBytes('abc')).toThrow(RangeError);
    expect(() => base64ToBytes('ab=c')).toThrow(RangeError);
    expect(() => base64ToBytes('a*bc')).toThrow(RangeError);
    expect(() => decodeBase64U16('AQID')).toThrow(/nieparzy/);
  });
});

describe('encodeLayer / decodeLayer', () => {
  it('auto wybiera RLE dla jednolitej warstwy, base64 dla szumu', () => {
    expect(encodeLayer(new Uint16Array(CHUNK_TILES).fill(2))).toEqual({ rle: [[2, 1024]] });
    expect(encodeLayer(noise())).toHaveProperty('base64');
    expect(decodeLayer(encodeLayer(noise(), 'rle'))).toEqual(noise());
    expect(decodeLayer(encodeLayer(noise(), 'base64'))).toEqual(noise());
  });

  it('pilnuje długości 1024 przy kodowaniu i dekodowaniu', () => {
    expect(() => encodeLayer(new Uint16Array(10))).toThrow(RangeError);
    expect(() => decodeLayer({ base64: encodeBase64U16(new Uint16Array(1023)) })).toThrow(
      /1023 kafli/,
    );
  });
});
