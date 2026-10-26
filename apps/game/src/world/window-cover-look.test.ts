import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CLOTHING_COVERAGE, coverLook, coverMaterial, coverMatrix } from './window-cover-look.js';

describe('coverLook', () => {
  it('opaque when the cover blocks sight', () => {
    const l = coverLook({ item: 'base:blanket', lightPass: 0.1, blocksSight: true });
    expect(l).toMatchObject({ style: 'sheet', alpha: 1, coverage: 1, glow: 0.1 });
  });
  it('clothing hangs over ~78 % of the glass', () => {
    const l = coverLook({ item: 'base:jacket', lightPass: 0.3, blocksSight: true });
    expect(l.style).toBe('clothing');
    expect(l.coverage).toBe(CLOTHING_COVERAGE);
  });
  it('lightPass alone makes the panel see-through by that much', () => {
    expect(
      coverLook({ item: 'base:curtain', lightPass: 0.15, blocksSight: false }).alpha,
    ).toBeCloseTo(0.85);
    expect(coverLook({ item: 'base:sheet', lightPass: 0.9, blocksSight: false }).alpha).toBe(0.3);
  });
  it('unknown items fall back by lightPass', () => {
    expect(coverLook({ item: 'mod:x', lightPass: 0.4, blocksSight: true }).style).toBe('clothing');
    expect(coverLook({ item: 'mod:y', lightPass: 0, blocksSight: true }).style).toBe('sheet');
  });
  it('tarp lets no light out', () => {
    expect(coverLook({ item: 'base:tarp', lightPass: 0, blocksSight: true }).glow).toBe(0);
  });
});

describe('coverMatrix', () => {
  const parts = (m: Matrix4) => {
    const p = new Vector3();
    const s = new Vector3();
    m.decompose(p, new Quaternion(), s);
    return { p, s };
  };
  it('zero scale when hidden', () => {
    const m = coverMatrix(new Matrix4(), { tx: 1, ty: 2, z: 0, side: 'n' }, 1, false);
    expect(m.determinant()).toBe(0);
  });
  it('centres a north window on its edge; clothing hangs from the top', () => {
    const full = parts(coverMatrix(new Matrix4(), { tx: 3, ty: 5, z: 0, side: 'n' }, 1, true));
    expect(full.p.x).toBeCloseTo(3.5);
    expect(full.p.z).toBeCloseTo(5);
    const part = parts(coverMatrix(new Matrix4(), { tx: 3, ty: 5, z: 0, side: 'n' }, 0.78, true));
    expect(part.s.y).toBeCloseTo(full.s.y * 0.78);
    expect(part.p.y + part.s.y / 2).toBeCloseTo(full.p.y + full.s.y / 2);
  });
  it('west windows run along z', () => {
    const { p } = parts(coverMatrix(new Matrix4(), { tx: 3, ty: 5, z: 1, side: 'w' }, 1, true));
    expect(p.x).toBeCloseTo(3);
    expect(p.z).toBeCloseTo(5.5);
  });
});

it('one shared material for every view', () => {
  expect(coverMaterial()).toBe(coverMaterial());
});
