import { expect, it } from 'vitest';
import { HashWriter, xxhash32 } from './hash.js';

const bytes = (s: string): Uint8Array => Uint8Array.from(s, (ch) => ch.charCodeAt(0)); // ASCII only

it('xxhash32 matches reference vectors', () => {
  expect(xxhash32(bytes(''))).toBe(0x02cc5d05);
  expect(xxhash32(bytes('a'))).toBe(0x550d7456);
  expect(xxhash32(bytes('abc'))).toBe(0x32d153ff);
  expect(xxhash32(bytes('Nobody inspects the spammish repetition'))).toBe(0xe2293b2f);
});

it('HashWriter grows and hashes little-endian words', () => {
  const w = new HashWriter();
  for (let i = 0; i < 1000; i++) w.u32(i).f32(i / 3);
  expect(w.bytes().length).toBe(8000);
  const again = new HashWriter();
  for (let i = 0; i < 1000; i++) again.u32(i).f32(i / 3);
  expect(again.digest()).toBe(w.digest());
});
