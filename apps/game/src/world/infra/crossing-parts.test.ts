import type { Matrix4 } from 'three';
import { BoxGeometry, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CROSSING_CORE,
  CROSSING_LEFT,
  CROSSING_RIGHT,
  liftRails,
  RAIL_LIFT,
  splitCrossing,
} from './crossing-parts.js';
import { addCrossing } from './infra-layer.js';

it('przejazd dzieli się na płyty z torem i wyposażenie po obu stronach', () => {
  const plate = new BoxGeometry(7.2, 0.6, 7.2);
  const sign = (x: number) => new BoxGeometry(0.2, 4, 0.2).translate(x, 2, 4.5);
  const parts = splitCrossing(mergeGeometries([plate, sign(-5.5), sign(5.5)]));
  const n = (id: string) => parts.get(id)!.getAttribute('position').count;
  expect(n(CROSSING_CORE)).toBe(36);
  expect(n(CROSSING_LEFT)).toBe(36);
  expect(n(CROSSING_RIGHT)).toBe(36);
});

it('addCrossing: rozciąga płyty, wyposażenie tylko po stronach z `furn`, ramiona przy krawędzi', () => {
  const got: [string, Matrix4][] = [];
  addCrossing({ m: 'przejazd-kat-a', x: 10, y: 20, rot: 0, len: 1.5, furn: 2 }, (id, m) =>
    got.push([id, m]),
  );
  expect(got.map(([id]) => id)).toEqual([CROSSING_CORE, CROSSING_RIGHT, 'przejazd-rogatka-ramie']);
  const s = new Vector3().setFromMatrixScale(got[0]![1]);
  expect(s.z).toBeCloseTo(1.5);
  const arm = new Vector3().setFromMatrixPosition(got[2]![1]);
  // Hinge (4.6, -4.3) with z stretched ×1.5.
  expect(arm.x).toBeCloseTo(14.6);
  expect(arm.z).toBeCloseTo(20 - 4.3 * 1.5);
});

it('liftRails: główki szyn ponad płyty, płyty bez zmian', () => {
  const rail = new BoxGeometry(0.1, 0.18, 1).translate(0.75, 0.57, 0);
  const plate = new BoxGeometry(1, 0.65, 1).translate(2, 0.325, 0);
  const g = liftRails(mergeGeometries([rail, plate]));
  g.computeBoundingBox();
  expect(g.boundingBox!.max.y).toBeCloseTo(0.66 + RAIL_LIFT);
  const ys = Array.from({ length: 24 }, (_, i) => g.getAttribute('position').getY(24 + i));
  expect(Math.max(...ys)).toBeCloseTo(0.65);
});
