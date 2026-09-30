import { encodeToKTX2 } from 'ktx2-encoder';
import { PNG } from 'pngjs';

export type TextureEncoding = 'uastc' | 'etc1s' | 'png';

/**
 * PNG → KTX2 (Basis Universal) using the WASM encoder, so no native toktx/basisu is needed
 * (works on CI). `png` keeps the source as is.
 */
export async function encodeTexture(
  png: Uint8Array,
  encoding: TextureEncoding,
): Promise<Uint8Array> {
  if (encoding === 'png') return png;
  const img = PNG.sync.read(Buffer.from(png));
  return encodeToKTX2(png, {
    isUASTC: encoding === 'uastc',
    generateMipmap: false,
    imageDecoder: () =>
      Promise.resolve({ data: new Uint8Array(img.data), width: img.width, height: img.height }),
  });
}
