import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createIsometricCamera } from '../camera/isometric.js';
import { clientToNdc, intersectFloor, ndcToFloor } from './aim.js';

describe('aim', () => {
  it('maps client pixels to NDC', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    expect(clientToNdc(110, 70, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToNdc(10, 20, rect)).toEqual({ x: -1, y: 1 });
    expect(clientToNdc(210, 120, rect)).toEqual({ x: 1, y: -1 });
  });

  it('intersects a ray with the floor plane', () => {
    expect(intersectFloor({ x: 1, y: 2, z: 3 }, { x: 1, y: -1, z: 0 })).toEqual({ x: 3, z: 3 });
    expect(intersectFloor({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 1 }, 3)).toEqual({ x: 0, z: 2 });
    expect(intersectFloor({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 })).toBeUndefined();
    expect(intersectFloor({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 })).toBeUndefined();
  });

  it('screen centre hits the camera target', () => {
    const target = new Vector3(7, 0, -4);
    const cam = createIsometricCamera({ aspect: 16 / 9, viewHeight: 20, target });
    const hit = ndcToFloor(cam, 0, 0);
    expect(hit?.x).toBeCloseTo(7);
    expect(hit?.z).toBeCloseTo(-4);
  });

  it('round-trips a projected floor point', () => {
    const cam = createIsometricCamera({ aspect: 1, viewHeight: 10 });
    const p = new Vector3(2.5, 0, -1.25);
    const ndc = p.clone().project(cam);
    const hit = ndcToFloor(cam, ndc.x, ndc.y);
    expect(hit?.x).toBeCloseTo(2.5);
    expect(hit?.z).toBeCloseTo(-1.25);
  });
});
