import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../chunk.js';
import { tileGrey } from '../terrain.js';
import {
  LOD_FOREST,
  LOD_GROUND,
  buildFarGeometry,
  buildMidGeometry,
  forestCells,
  lodGroundColor,
  summarize,
} from './lod-meshes.js';
import type { WorldChunk } from './source.js';

const PALETTE = [null, 'base:grass', 'base:water', 'base:asphalt', 'base:roof-flat'];
const GRASS = 1;
const WATER = 2;

/** One ground level: west half grass, east half water; trees on the north-west 4 × 4 cell. */
function chunk(trees: number): WorldChunk {
  const floor = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let i = 0; i < floor.length; i++) floor[i] = i % CHUNK_SIZE < 16 ? GRASS : WATER;
  const decor = Array.from({ length: trees }, (_, k) => ({
    kind: 'base:tree',
    x: 0.5 + k,
    y: 1.5,
    z: 0,
    rot: 0,
    scale: 1,
  }));
  return {
    cx: 0,
    cy: 0,
    levels: new Map([[0, { floor } as never]]),
    decor,
  } as unknown as WorldChunk;
}

/** Distinct vertex colours of a geometry (hex). */
function colours(g: {
  getAttribute(n: string): {
    count: number;
    getX(i: number): number;
    getY(i: number): number;
    getZ(i: number): number;
  };
}): Set<string> {
  const a = g.getAttribute('color');
  const out = new Set<string>();
  const c = new Color();
  for (let i = 0; i < a.count; i++)
    out.add(`#${c.setRGB(a.getX(i), a.getY(i), a.getZ(i)).getHexString()}`);
  return out;
}

describe('LOD ground colours', () => {
  it('floor content → its ground colour; unknown floors and no palette stay grey', () => {
    expect(lodGroundColor(WATER, PALETTE)).toBe(LOD_GROUND['base:water']);
    expect(lodGroundColor(GRASS, PALETTE, true)).toBe(LOD_FOREST);
    expect(lodGroundColor(WATER, PALETTE, true)).toBe(LOD_GROUND['base:water']);
    expect(lodGroundColor(4, PALETTE)).toBe(tileGrey(4));
    expect(lodGroundColor(WATER, undefined)).toBe(tileGrey(WATER));
  });

  it('forest cells need enough trees', () => {
    expect(forestCells(chunk(1))).toBeUndefined();
    const f = forestCells(chunk(2))!;
    expect(f[0]).toBe(1);
    expect(f.reduce((s, v) => s + v, 0)).toBe(1);
  });

  it('mid and far LOD draw water, grass and forest in their colours', () => {
    const c = chunk(3);
    const want = [LOD_GROUND['base:water'], LOD_GROUND['base:grass'], LOD_FOREST];
    const mid = colours(buildMidGeometry(c, undefined, PALETTE)!.geometry);
    const far = colours(buildFarGeometry(summarize(c), PALETTE)!.geometry);
    for (const set of [mid, far]) expect([...set].sort()).toEqual([...want].sort());
    // Without a palette: placeholder greys as before.
    expect(colours(buildMidGeometry(c, undefined)!.geometry).has(LOD_GROUND['base:water']!)).toBe(
      false,
    );
  });
});
