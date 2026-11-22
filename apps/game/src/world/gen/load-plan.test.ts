import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inflateTile } from './load-plan.js';

const text = (b: ArrayBuffer) => new TextDecoder().decode(b);
const buf = (u: Uint8Array) =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe('inflateTile', () => {
  it('inflates gzipped tiles (stw2 .json.gz) and passes plain JSON through', async () => {
    const json = JSON.stringify({ format: 'deadzone-osm-1', roads: [1, 2, 3] });
    expect(text(await inflateTile(buf(gzipSync(json))))).toBe(json);
    expect(text(await inflateTile(buf(new TextEncoder().encode(json))))).toBe(json);
  });
});
