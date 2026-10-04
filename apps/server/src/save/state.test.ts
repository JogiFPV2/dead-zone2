import {
  EXPLORED_BITMAP_BYTES,
  MAP_MARKER_ICONS,
  MAP_SIZE_M,
  PLAYER_MAP_TRAIL_MAX_POINTS,
  PLAYER_MAP_TRAIL_SPACING_M,
} from '@deadzone/protocol';
import { SAVE_VERSION, decodeTrail, encodeTrail, encodeZeroRle } from '@deadzone/sim';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../errors.js';
import { realSave } from '../test/sim-save.js';
import { validateState } from './state.js';

const SEED = 4242;
type Json = Record<string, unknown>;
type Map0 = { discovered: string; trail: string; markers: unknown[][]; nextId: number };

const save = (): Json => realSave(SEED);
const map0 = (s: Json): Map0 => (s.playerMaps as Map0[])[0]!;
const lod = (s: Json): Json => s.lod as Json;
const check = (s: Json, version = SAVE_VERSION, seed = SEED) => validateState(s, version, seed);
const rejects = (s: Json, re: RegExp, version = SAVE_VERSION) => {
  let err: unknown;
  try {
    check(s, version);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(HttpError);
  expect(err).toMatchObject({ statusCode: 422, code: 'invalid_state' });
  expect((err as Error).message).toMatch(re);
};

describe('real v3 save from the sim', () => {
  it('passes and has the v3 sections the server checks', () => {
    const s = save();
    expect(s.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(3);
    expect(check(s).playerMaps).toHaveLength(1);
    const m = map0(s);
    expect(m.markers.map((k) => k[3])).toEqual([...MAP_MARKER_ICONS]);
    expect(decodeTrail(m.trail).length / 2).toBeGreaterThan(2);
    expect(lod(s)).toMatchObject({ cellsW: 32, cellsH: 32 });
    for (const k of ['components', 'survival', 'items', 'openings', 'physics', 'world'])
      expect(s).toHaveProperty(k);
  });

  it('accepts v1 and v2 (the sim still loads them), refuses other versions', () => {
    for (const v of [1, 2]) {
      const s = save();
      s.version = v;
      expect(check(s, v).version).toBe(v);
    }
    const s4 = save();
    s4.version = 4;
    rejects(s4, /version/, 4);
    rejects(save(), /does not match header/, 2);
  });

  it('the sim seed must be the character world seed', () => {
    expect(() => check(save(), SAVE_VERSION, SEED + 1)).toThrow(/seed/);
  });
});

describe('player map', () => {
  it('explored bitmap: up to 512² bits, valid zero-run base64', () => {
    const full = save();
    map0(full).discovered = encodeZeroRle(new Uint8Array(EXPLORED_BITMAP_BYTES).fill(0xff));
    check(full);
    const big = save();
    map0(big).discovered = encodeZeroRle(new Uint8Array(EXPLORED_BITMAP_BYTES + 1).fill(1));
    rejects(big, /discovered/);
    const junk = save();
    map0(junk).discovered = 'not base64!';
    rejects(junk, /discovered/);
    const cut = save();
    map0(cut).discovered = 'gA==';
    rejects(cut, /discovered/);
  });

  it('trail: whole metres inside the map, ≥ 16 m apart, at most 20 000 points', () => {
    const sp = PLAYER_MAP_TRAIL_SPACING_M;
    const ok = save();
    map0(ok).trail = encodeTrail([0, 0, sp, 0, MAP_SIZE_M, MAP_SIZE_M]);
    check(ok);
    const dense = save();
    map0(dense).trail = encodeTrail([100, 100, 100 + sp - 1, 100]);
    rejects(dense, /dense/);
    const out = save();
    map0(out).trail = encodeTrail([0, 0, MAP_SIZE_M + sp, 0]);
    rejects(out, /outside/);
    const long = save();
    const pts: number[] = [];
    for (let i = 0; i <= PLAYER_MAP_TRAIL_MAX_POINTS; i++) pts.push((i % 2) * sp, 0);
    map0(long).trail = encodeTrail(pts);
    rejects(long, /too many/);
  });

  it('markers: shared icons and colours, 40 characters (emoji = 1), ids below nextId', () => {
    const base = () => {
      const s = save();
      return { s, k: map0(s).markers[0]! };
    };
    const emoji = base();
    emoji.k[5] = '🍞'.repeat(40);
    check(emoji.s);
    const long = base();
    long.k[5] = 'x'.repeat(41);
    rejects(long.s, /markers/);
    const ctrl = base();
    ctrl.k[5] = 'a\nb';
    rejects(ctrl.s, /markers/);
    const icon = base();
    icon.k[3] = 'base:marker-unicorn';
    rejects(icon.s, /markers/);
    const colour = base();
    colour.k[4] = 'pink';
    rejects(colour.s, /markers/);
    const far = base();
    far.k[1] = MAP_SIZE_M + 1;
    rejects(far.s, /outside the map/);
    const dup = save();
    const ms = map0(dup).markers;
    ms[1]![0] = ms[0]![0];
    rejects(dup, /marker id/);
    const next = save();
    map0(next).nextId = 1;
    rejects(next, /marker id/);
  });
});

describe('LOD world delta (#104)', () => {
  it('grid arrays must match cellsW × cellsH (× types); grid bounded by the map', () => {
    const counts = save();
    lod(counts).counts = encodeZeroRle(new Uint16Array(10));
    rejects(counts, /lod\.counts/);
    const active = save();
    lod(active).active = encodeZeroRle(new Uint8Array(32 * 32 + 1));
    rejects(active, /lod\.active/);
    const wide = save();
    lod(wide).cellsW = 513;
    rejects(wide, /lod\.cellsW/);
    const sig = save();
    lod(sig).sig = [[512 * 512, 1]];
    rejects(sig, /lod\.sig/);
  });

  it('floor counters and stair masks (sim 9.39): optional, cells inside the grid', () => {
    const ok = save();
    const types = lod(ok).types as number;
    lod(ok).floors = [[5, new Array(3 * types).fill(1)]];
    lod(ok).links = [[5, 0b11]];
    expect(() => check(ok)).not.toThrow();
    const out = save();
    lod(out).floors = [[32 * 32, new Array(types).fill(1)]];
    rejects(out, /lod\.floors/);
    const ragged = save();
    lod(ragged).floors = [[1, new Array(types + 1).fill(1)]];
    if (types > 1) rejects(ragged, /lod\.floors/);
    const link = save();
    lod(link).links = [[32 * 32, 1]];
    rejects(link, /lod\.links/);
  });
});
