/**
 * Base64 warstwy `Uint16Array` (little-endian, 2 bajty na kafel). Własna implementacja
 * bez `Buffer`/`atob`, żeby działała tak samo w przeglądarce, workerze i Node.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...ALPHABET].map((c, i) => [c, i]));
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (bytes[i]! << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!;
    out += c === undefined ? '=' : ALPHABET[n & 63]!;
  }
  return out;
}

/** Rzuca `RangeError` dla tekstu, który nie jest poprawnym base64 (z dopełnieniem `=`). */
export function base64ToBytes(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !BASE64_PATTERN.test(text)) {
    throw new RangeError('niepoprawny base64 (alfabet A–Z a–z 0–9 + /, długość podzielna przez 4)');
  }
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) n = (n << 6) | (LOOKUP.get(text[i + j]!) ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** `Uint16Array` → base64 (little-endian). */
export function encodeBase64U16(values: Uint16Array): string {
  const bytes = new Uint8Array(values.length * 2);
  values.forEach((v, i) => {
    bytes[2 * i] = v & 255;
    bytes[2 * i + 1] = v >> 8;
  });
  return bytesToBase64(bytes);
}

/** base64 (little-endian) → `Uint16Array`. Rzuca `RangeError` przy nieparzystej liczbie bajtów. */
export function decodeBase64U16(text: string): Uint16Array {
  const bytes = base64ToBytes(text);
  if (bytes.length % 2 !== 0) {
    throw new RangeError(`base64 ma ${bytes.length} bajtów — nieparzyście dla uint16`);
  }
  const out = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = bytes[2 * i]! | (bytes[2 * i + 1]! << 8);
  return out;
}
