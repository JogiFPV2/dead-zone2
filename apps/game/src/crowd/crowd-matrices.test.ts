import { expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { facingToRotationY } from '../sim/coords.js';
import { LEVEL_HEIGHT } from '../world/instances.js';
import { writeCrowdMatrices } from './crowd-matrices.js';

it('matches three.js translation * rotationY(-facing) with sim -> world axes', () => {
  const sampled = new Float32Array([1, 2, 0, 0.7, -3, 4, 1, -2]);
  const out = new Float32Array(32);
  writeCrowdMatrices(sampled, 2, out);
  const expected = (x: number, y: number, z: number, f: number) =>
    new Matrix4()
      .makeRotationY(facingToRotationY(f))
      .setPosition(x, z * LEVEL_HEIGHT, y)
      .toArray();
  const a = Array.from(out.subarray(0, 16));
  const b = Array.from(out.subarray(16, 32));
  expected(1, 2, 0, 0.7).forEach((v, i) => expect(a[i]).toBeCloseTo(v, 5));
  expected(-3, 4, 1, -2).forEach((v, i) => expect(b[i]).toBeCloseTo(v, 5));
});
