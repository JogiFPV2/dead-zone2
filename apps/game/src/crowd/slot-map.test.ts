import { expect, it } from 'vitest';
import { SlotMap } from './slot-map.js';

it('allocates dense slots, swap-removes and grows in chunks', () => {
  const m = new SlotMap(2, 3);
  expect([m.add(10), m.add(11), m.add(10)]).toEqual([0, 1, 0]);
  expect(m.capacity).toBe(2);
  expect(m.add(12)).toBe(2);
  expect(m.capacity).toBe(5);

  const moves: [number, number][] = [];
  expect(m.remove(10, (from, to) => moves.push([from, to]))).toBe(true);
  expect(moves).toEqual([[2, 0]]);
  expect([m.size, m.get(12), m.idAt(0), m.get(10)]).toEqual([2, 0, 12, undefined]);

  expect(m.remove(11, () => moves.push([-1, -1]))).toBe(true);
  expect(moves).toHaveLength(1);
  expect(m.remove(99)).toBe(false);
  expect(m.size).toBe(1);
});
