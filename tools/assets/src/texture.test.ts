import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { encodeTexture } from './texture.js';

const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb];

describe('encodeTexture', () => {
  it('encodes a PNG to KTX2 with the WASM Basis encoder (no native binaries)', async () => {
    const png = new PNG({ width: 8, height: 8 });
    png.data.fill(128);
    const src = new Uint8Array(PNG.sync.write(png));
    const out = await encodeTexture(src, 'uastc');
    expect([...out.slice(0, 8)]).toEqual(KTX2_MAGIC);
    expect(await encodeTexture(src, 'png')).toBe(src);
  });
});
