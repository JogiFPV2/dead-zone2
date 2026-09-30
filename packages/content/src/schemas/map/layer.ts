import { z } from 'zod';
import { decodeBase64U16, encodeBase64U16 } from './codec-base64.js';
import { decodeRle, encodeRle } from './codec-rle.js';
import { CHUNK_TILES } from './constants.js';

const U16 = z.number().int().min(0).max(0xffff);

/** Warstwa jako RLE: `{ "rle": [[wartość, powtórzenia], …] }`, suma powtórzeń = 1024. */
export const RleLayerSchema = z.strictObject({
  rle: z.array(z.tuple([U16, z.number().int().min(1).max(CHUNK_TILES)])).min(1),
});

/** Warstwa jako base64 z `Uint16Array` (little-endian): `{ "base64": "…" }`, 2048 bajtów. */
export const Base64LayerSchema = z.strictObject({ base64: z.string() });

/** Warstwa w JSON (przed dekodowaniem). */
export const EncodedLayerSchema = z.union([RleLayerSchema, Base64LayerSchema]);
export type EncodedLayer = z.infer<typeof EncodedLayerSchema>;
export type LayerEncoding = 'rle' | 'base64' | 'auto';

/** Dekoduje warstwę do `Uint16Array` długości 1024; rzuca `RangeError` przy innej długości. */
export function decodeLayer(layer: EncodedLayer): Uint16Array {
  const out = 'rle' in layer ? decodeRle(layer.rle) : decodeBase64U16(layer.base64);
  if (out.length !== CHUNK_TILES) {
    throw new RangeError(`warstwa ma ${out.length} kafli, oczekiwano ${CHUNK_TILES}`);
  }
  return out;
}

/** Koduje warstwę 1024 kafli; `auto` wybiera krótszy zapis JSON. */
export function encodeLayer(values: Uint16Array, encoding: LayerEncoding = 'auto'): EncodedLayer {
  if (values.length !== CHUNK_TILES) {
    throw new RangeError(`warstwa ma ${values.length} kafli, oczekiwano ${CHUNK_TILES}`);
  }
  const rle = { rle: encodeRle(values) };
  if (encoding === 'rle') return rle;
  const base64 = { base64: encodeBase64U16(values) };
  if (encoding === 'base64') return base64;
  return JSON.stringify(rle).length <= base64.base64.length + 12 ? rle : base64;
}

/** Warstwa z JSON → `Uint16Array[1024]` (indeks `y * 32 + x`). Błąd dekodowania to błąd schematu. */
export const LayerSchema = EncodedLayerSchema.transform((layer, ctx) => {
  try {
    return decodeLayer(layer);
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: (e as Error).message });
    return z.NEVER;
  }
});
