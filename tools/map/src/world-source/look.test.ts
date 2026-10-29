import { describe, expect, it } from 'vitest';
import { buildingLook, clampColour, hueBucket, jitter, lookType } from './look.js';
import { LOOK_PALETTE } from './look-palette.js';

const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
const look = (id: number, kind: string, extra: object = {}, floors = 2) =>
  buildingLook({ b: { id, kind: kind as never, ...extra }, floors, ...box })!;

describe('building look (look-spec §A–C)', () => {
  it('types: kamienica, publiczny, school, outbuilding, ruins none', () => {
    expect(lookType('house', 3, 100)).toBe('kamienica');
    expect(lookType('tenement', 2, 100)).toBe('kamienica');
    expect(lookType('office', 3, 900)).toBe('public');
    expect(lookType('church', 1, 100)).toBe('public');
    expect(lookType('school', 2, 100)).toBe('school');
    expect(lookType('garage', 1, 20)).toBe('outbuilding');
    expect(lookType('ruin', 1, 20)).toBeUndefined();
  });
  it('stable by OSM id and from the type palette', () => {
    const a = look(123, 'shop');
    expect(look(123, 'shop')).toEqual(a);
    expect(a.wallColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(LOOK_PALETTE.service.trim).toContain(a.trimColor);
    expect(LOOK_PALETTE.service.walls).toContain(a.pair.slice(0, 7));
  });
  it('houses vary; no wall colour over 30 %', () => {
    const n = new Map<string, number>();
    for (let i = 1; i <= 400; i++) {
      const w = look(i * 7919, 'house').wallColor;
      n.set(w, (n.get(w) ?? 0) + 1);
    }
    expect(n.size).toBeGreaterThan(5);
    expect(Math.max(...n.values()) / 400).toBeLessThanOrEqual(0.3);
  });
  it('OSM colour and roof shape first, clamped to muted tones', () => {
    const l = look(5, 'house', { colour: '#ff0000', roofShape: 'hipped' });
    expect(l.roofShape).toBe('hipped');
    expect(l.wallColor).not.toBe('#ff0000');
    expect(clampColour('#ff0000')).toMatch(/^#[0-9a-f]{6}$/);
    expect(clampColour('white')).toBe('#d9d9d9');
    expect(clampColour('nonsense')).toBeUndefined();
  });
  it('jitter stays within L ±6 %, H ±4°', () => {
    expect(jitter('#808080', 0, 0.06)).toBe('#888888');
    expect(hueBucket(jitter('#d9d2c3', 4, 0))).toBe(hueBucket('#d9d2c3'));
  });
  it('rail / edge raise abandoned + ruin, centre lowers it', () => {
    const bad = (o: object) => {
      let n = 0;
      for (let i = 1; i <= 2000; i++) {
        const c = buildingLook({ b: { id: i, kind: 'house' }, floors: 1, ...box, ...o })!.condition;
        if (c === 'abandoned' || c === 'ruin') n++;
      }
      return n;
    };
    expect(bad({ nearRail: true })).toBeGreaterThan(bad({}));
    expect(bad({ centre: true })).toBeLessThan(bad({}));
  });
  it('condition has its own seed; ruins are ruins; church tower', () => {
    const s = new Set<string>();
    for (let i = 1; i <= 500; i++) s.add(look(i, 'house').condition);
    expect(s.has('ok') && s.size > 1).toBe(true);
    expect(look(1, 'church', { tall: 1 }).tower).toBe(1);
  });
  it('the neighbour shift changes the wall + roof pair', () => {
    const a = buildingLook({ b: { id: 9, kind: 'house' }, floors: 1, ...box })!;
    const b = buildingLook({ b: { id: 9, kind: 'house' }, floors: 1, ...box, shift: 1 })!;
    expect(a.pair).not.toBe(b.pair);
  });
});
