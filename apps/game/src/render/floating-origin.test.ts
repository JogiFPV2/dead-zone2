import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import {
  FloatingOrigin,
  RECENTER_DISTANCE,
  chunkCorner,
  recenter,
  renderToWorld,
  worldToRender,
} from './floating-origin.js';
import { simToRender, renderToSimFloor, simToWorld } from '../sim/coords.js';
import { ndcToFloor } from '../input/aim.js';
import { CameraRig } from '../camera/rig.js';
import { LEVEL_HEIGHT } from '../world/instances.js';

describe('recenter', () => {
  it('keeps the origin within the distance (per axis)', () => {
    expect(recenter(0, 0, RECENTER_DISTANCE, -RECENTER_DISTANCE)).toBeUndefined();
    expect(recenter(4096, 4096, 4096 + 999, 4096 - 999)).toBeUndefined();
  });

  it('moves to the chunk corner of the focus beyond it', () => {
    expect(recenter(0, 0, 1000.5, 10)).toEqual({ x: 992, z: 0 });
    expect(recenter(0, 0, 16000.7, 16010.2)).toEqual({ x: 16000, z: 16000 });
    expect(recenter(0, 0, -1500, 3)).toEqual({ x: -1504, z: 0 });
  });

  it('chunkCorner snaps down to 32 m', () => {
    expect(chunkCorner(63.9, 64)).toEqual([32, 64]);
  });
});

describe('world <-> render', () => {
  it('round-trips points', () => {
    const o = { x: 16000, z: 15968 };
    const p = { x: 16012.25, y: 3, z: 15970.5 };
    expect(worldToRender(o, { ...p })).toEqual({ x: 12.25, y: 3, z: 2.5 });
    expect(renderToWorld(o, worldToRender(o, { ...p }))).toEqual(p);
  });

  it('simToRender = simToWorld − origin; renderToSimFloor inverts it', () => {
    const o = { x: 16000, z: 16032 };
    const w = simToWorld(16001.5, 16040.25, 1);
    expect(simToRender(16001.5, 16040.25, 1, o)).toEqual({
      x: w.x - o.x,
      y: LEVEL_HEIGHT,
      z: w.z - o.z,
    });
    expect(renderToSimFloor(1.5, 8.25, o)).toEqual({ x: 16001.5, y: 16040.25 });
  });
});

describe('FloatingOrigin', () => {
  it('shifts the world root by −origin and notifies listeners', () => {
    const f = new FloatingOrigin();
    const seen: number[] = [];
    f.onShift((o) => seen.push(o.x, o.z));
    expect(f.update(500, 500)).toBe(false);
    expect(f.update(16000.4, 16020)).toBe(true);
    expect([f.x, f.z]).toEqual([16000, 16000]);
    expect(f.root.position.toArray()).toEqual([-16000, 0, -16000]);
    expect(seen).toEqual([16000, 16000]);
    expect(f.update(16500, 16900)).toBe(false);
  });

  it('a world point under the root lands near the camera in render space', () => {
    const f = new FloatingOrigin();
    f.set(16000, 16000);
    const p = new Vector3(16010, 0, 16020);
    f.root.updateMatrixWorld(true);
    expect(p.clone().applyMatrix4(f.root.matrixWorld).toArray()).toEqual([10, 0, 20]);
  });

  it('world camera picks the same world floor point as before the shift', () => {
    const cam = new OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
    const rig = new CameraRig(cam);
    const f = new FloatingOrigin();
    rig.origin = f;
    const world = cam.clone();
    rig.target.set(16012.5, 0, 16008.5);
    rig.update(0);
    f.syncWorldCamera(cam, world);
    const before = ndcToFloor(world, 0.3, -0.2)!;
    f.update(rig.target.x, rig.target.z);
    rig.update(16);
    f.syncWorldCamera(cam, world);
    // The render camera stays near (0, 0) …
    expect(Math.abs(cam.position.x)).toBeLessThan(200);
    expect(Math.abs(cam.position.z)).toBeLessThan(200);
    // … and picking through the world camera is unchanged (world coordinates).
    const after = ndcToFloor(world, 0.3, -0.2)!;
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
    // Projecting a world point gives the same screen point as before the shift.
    const v = new Vector3(16012.5, 0, 16008.5).project(world);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });
});
