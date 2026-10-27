import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, ShaderLib, Texture, UniformsUtils } from 'three';
import {
  DETAIL_CELLS,
  V2_DETAIL,
  detailCode,
  paintDetailIndex,
  withFacadeDetail,
} from './bld-detail.js';
import { V2_CELLS } from './bld-v2.js';

describe('facade detail', () => {
  it('atlas metadata matches the cells (16, CC0 ambientCG)', () => {
    const meta = JSON.parse(
      readFileSync(
        new URL('../../../public/models/deadzone-town/facade-detail.json', import.meta.url),
        'utf8',
      ),
    ) as { size: number; cells: { id: string; source: string }[] };
    expect(meta.size).toBe(2048);
    expect(meta.cells.map((c) => c.id)).toEqual([...DETAIL_CELLS]);
    for (const c of meta.cells) expect(c.source).toMatch(/^ambientCG .*CC0 1\.0/);
  });
  it('every v2 cell has a detail; walls/roofs by type', () => {
    for (const [name] of V2_CELLS) expect(V2_DETAIL.get(name)).toBeDefined();
    expect(new Set(V2_DETAIL.values()).size).toBeGreaterThan(5);
  });
  it('codes are distinct, non-zero, < 256', () => {
    const codes = DETAIL_CELLS.map(detailCode);
    expect(new Set(codes).size).toBe(16);
    expect(Math.min(...codes)).toBeGreaterThan(7);
    expect(Math.max(...codes)).toBeLessThan(256);
  });
  it('index map paints only v2 sub-cells', () => {
    const rects: [string, number, number, number, number][] = [];
    const ctx = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        rects.push([this.fillStyle, x, y, w, h]);
      },
    };
    paintDetailIndex(ctx, 256);
    expect(rects[0]).toEqual(['#000000', 0, 0, 256, 256]);
    expect(rects).toHaveLength(1 + V2_CELLS.length);
    expect(rects.every(([, , , w]) => w === 256 || w === 8)).toBe(true);
  });
  it('patches the same material (one program, no new material)', () => {
    const m = new MeshStandardMaterial();
    withFacadeDetail(m, new Texture(), new Texture(), [2]);
    const sh = {
      uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    m.onBeforeCompile(sh as never, undefined as never);
    expect(sh.vertexShader).toContain('vDzWp');
    expect(sh.fragmentShader).toContain('dzDetailIdx');
    expect(sh.uniforms).toHaveProperty('dzDetail');
    expect(m.customProgramCacheKey()).toContain('dz-detail');
  });
});
