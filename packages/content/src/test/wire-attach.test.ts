import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { attachFileSchema, attachPoint, attachPointSchema, WIRE_RULES } from '../wires/index.js';

const hv = {
  modelId: 'pole-hv110-lattice',
  kind: 'hv110',
  attach: [
    { id: 'L1', x: -3.5, y: 18, z: 0 },
    { id: 'L2', x: 3.5, y: 18, z: 0 },
    { id: 'L3', x: -3, y: 22, z: 0 },
    { id: 'GW', x: 0, y: 26, z: 0 },
  ],
};
const p = (id: string, y = 8) => ({ id, x: 0, y, z: 0 });
const ok = (v: unknown) => attachFileSchema.safeParse(v).success;

describe('attachFileSchema', () => {
  it('przyjmuje 110/400 kV z GW i bez', () => {
    expect(ok(hv)).toBe(true);
    expect(ok({ ...hv, kind: 'hv400', attach: hv.attach.slice(0, 3) })).toBe(true);
  });
  it('nN: N albo N + L1–L3; trakcja: CW + MW', () => {
    expect(ok({ modelId: 'lv', kind: 'lv', attach: [p('N')] })).toBe(true);
    expect(
      ok({ modelId: 'lv', kind: 'lv', attach: ['L1', 'L2', 'L3', 'N'].map((i) => p(i)) }),
    ).toBe(true);
    expect(ok({ modelId: 'c', kind: 'catenary', attach: [p('MW', 7), p('CW', 5.5)] })).toBe(true);
  });
  it.each([
    ['powtórzone id', { ...hv, attach: [...hv.attach, p('L1')] }],
    ['brak fazy', { ...hv, attach: hv.attach.slice(1) }],
    ['N na 110 kV', { ...hv, attach: [...hv.attach, p('N')] }],
    ['CW na nN', { modelId: 'lv', kind: 'lv', attach: [p('N'), p('CW')] }],
    ['nN z częścią faz', { modelId: 'lv', kind: 'lv', attach: [p('N'), p('L1')] }],
    ['trakcja bez MW', { modelId: 'c', kind: 'catenary', attach: [p('CW')] }],
    ['nieznany kind', { ...hv, kind: 'hv220' }],
    ['nieznane id', { ...hv, attach: [...hv.attach, p('L4')] }],
    ['pusta lista', { modelId: 'x', kind: 'catenary', attach: [] }],
    ['zły modelId', { ...hv, modelId: '../x' }],
    ['nieznane pole', { ...hv, extra: 1 }],
  ])('odrzuca: %s', (_, v) => {
    expect(ok(v)).toBe(false);
  });
  it.each([
    ['y = 0', { id: 'N', x: 0, y: 0, z: 0 }],
    ['y < 0', { id: 'N', x: 0, y: -1, z: 0 }],
    ['NaN', { id: 'N', x: Number.NaN, y: 1, z: 0 }],
    ['Infinity', { id: 'N', x: 0, y: Number.POSITIVE_INFINITY, z: 0 }],
    ['brak z', { id: 'N', x: 0, y: 1 }],
    ['string', { id: 'N', x: '0', y: 1, z: 0 }],
  ])('punkt: odrzuca %s', (_, v) => {
    expect(attachPointSchema.safeParse(v).success).toBe(false);
  });
  it('każda reguła: wymagane i opcjonalne są rozłączne', () => {
    for (const r of Object.values(WIRE_RULES)) {
      expect(r.required.filter((id) => r.optional.includes(id))).toEqual([]);
    }
  });
});

describe('attachPoint', () => {
  const file = attachFileSchema.parse(hv);
  it('zwraca punkt po id albo undefined', () => {
    expect(attachPoint(file, 'L2')).toEqual({ id: 'L2', x: 3.5, y: 18, z: 0 });
    expect(attachPoint({ ...file, attach: file.attach.slice(0, 3) }, 'GW')).toBeUndefined();
  });
});

describe('lekki moduł wires', () => {
  const dir = fileURLToPath(new URL('../wires/', import.meta.url));
  it.each(readdirSync(dir).map((f) => [f]))('%s importuje tylko zod i pliki lokalne', (f) => {
    const text = readFileSync(new URL(`../wires/${f}`, import.meta.url), 'utf8');
    for (const m of text.matchAll(/from ['"]([^'"]+)['"]/g)) expect(m[1]).toMatch(/^(zod|\.\/)/);
  });
});
