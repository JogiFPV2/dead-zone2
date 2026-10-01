import { describe, expect, it } from 'vitest';
import { SnapshotEntityKind, encodeSnapshot } from '@deadzone/protocol';
import { writeEntities } from '../sim/snapshot.js';
import { CrowdBuffer } from './crowd-buffer.js';

const player = { id: 1, x: 0, y: 0, z: 0, facing: 0 };
const e = (id: number, x: number, y = 0, facing = 0) => ({ id, x, y, z: 0, facing });
const snap = (...entities: ReturnType<typeof e>[]) => writeEntities([player, ...entities]);

describe('CrowdBuffer', () => {
  it('skips animals (no animal renderer yet)', () => {
    const b = new CrowdBuffer();
    const at = (stableId: number, x: number, kind: number) => ({
      stableId,
      x,
      y: 0,
      z: 0,
      facingRad: 0,
      kind,
    });
    const buf = encodeSnapshot([
      at(1, 0, SnapshotEntityKind.player),
      at(2, 3, SnapshotEntityKind.zombie),
      at(3, 4, SnapshotEntityKind.animal),
    ]);
    b.push(new Float32Array(buf));
    expect(b.count).toBe(1);
    expect(b.slots.idAt(0)).toBe(2);
  });

  it('skips the player and holds new entities still until the next snapshot', () => {
    const b = new CrowdBuffer();
    b.push(snap(e(5, 2, 3)));
    const out = new Float32Array(8);
    expect(b.sample(0.5, out)).toBe(1);
    expect(Array.from(out.subarray(0, 4))).toEqual([2, 3, 0, 0]);
  });

  it('interpolates each entity between its last two states, facing by the short arc', () => {
    const b = new CrowdBuffer();
    b.push(snap(e(5, 0, 0, 3), e(6, 10)));
    b.push(snap(e(5, 2, 4, -3), e(6, 20)));
    const out = new Float32Array(8);
    b.sample(0.5, out);
    expect(out[0]).toBeCloseTo(1);
    expect(out[1]).toBeCloseTo(2);
    expect(Math.abs(out[3] ?? 0)).toBeGreaterThan(3); // crosses ±π, not through 0
    expect(out[4]).toBeCloseTo(15);
  });

  it('handles entities disappearing and appearing, keeping slots dense', () => {
    const b = new CrowdBuffer();
    b.push(snap(e(5, 1), e(6, 2), e(7, 3)));
    b.push(snap(e(7, 4), e(8, 9)));
    expect(b.count).toBe(2);
    const out = new Float32Array(8);
    b.sample(1, out);
    const xs = new Map([
      [b.slots.idAt(0), out[0]],
      [b.slots.idAt(1), out[4]],
    ]);
    expect(xs).toEqual(
      new Map([
        [7, 4],
        [8, 9],
      ]),
    );
    b.sample(0, out);
    expect(out[b.slots.get(7)! * 4]).toBe(3); // history survived the swap-remove
  });

  it('grows capacity in chunks', () => {
    const b = new CrowdBuffer(4, 4);
    const many = Array.from({ length: 9 }, (_, i) => e(100 + i, i));
    b.push(snap(...many));
    b.push(snap(...many));
    expect([b.count, b.capacity]).toEqual([9, 12]);
    const out = new Float32Array(b.capacity * 4);
    b.sample(1, out);
    expect(out[8 * 4]).toBe(8);
  });

  it('does not allocate in sample (same output buffer, no new arrays needed)', () => {
    const b = new CrowdBuffer();
    b.push(snap(e(5, 1)));
    const out = new Float32Array(4);
    expect(b.sample(0.3, out)).toBe(1);
    expect(b.sample(0.7, out)).toBe(1);
  });
});
