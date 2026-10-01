import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { OpeningsView, openingMatrix, type OpeningEdge } from './openings.js';

const fence: OpeningEdge = { kind: 'fence', tx: 10, ty: 24, z: 0, side: 'n', building: -1 };
const door: OpeningEdge = { kind: 'door', tx: 13, ty: 19, z: 0, side: 'n', building: 0 };
const window: OpeningEdge = { kind: 'window', tx: 11, ty: 16, z: 0, side: 'w', building: 0 };

function decompose(m: Matrix4) {
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  m.decompose(p, q, s);
  // World-space extent of the piece along Y.
  const up = new Vector3(0, s.y, 0).applyQuaternion(q);
  const side = new Vector3(0, 0, s.z).applyQuaternion(q);
  return { p, height: Math.abs(up.y) + Math.abs(side.y), s };
}

describe('openingMatrix', () => {
  it('a closed fence stands, a broken one lies flat on the ground', () => {
    const up = decompose(openingMatrix(new Matrix4(), fence, 'closed', 0, false));
    expect(up.height).toBeCloseTo(1, 3);
    const down = decompose(openingMatrix(new Matrix4(), fence, 'broken', 0, false));
    expect(down.height).toBeLessThan(0.1);
    expect(down.p.y).toBeLessThan(0.1);
  });

  it('shake changes the pose of fences and doors', () => {
    for (const e of [fence, door]) {
      const a = openingMatrix(new Matrix4(), e, 'closed', 0, false);
      const b = openingMatrix(new Matrix4(), e, 'closed', 0.1, false);
      expect(a.equals(b)).toBe(false);
    }
  });

  it('an open door swings away from the frame, a broken one lies on the floor', () => {
    const closed = decompose(openingMatrix(new Matrix4(), door, 'closed', 0, false));
    const open = decompose(openingMatrix(new Matrix4(), door, 'open', 0, false));
    expect(Math.abs(open.p.z - closed.p.z)).toBeGreaterThan(0.3);
    const broken = decompose(openingMatrix(new Matrix4(), door, 'broken', 0, false));
    expect(broken.height).toBeLessThan(0.1);
  });

  it('open / broken windows hide the pane', () => {
    expect(openingMatrix(new Matrix4(), window, 'closed', 0, false).determinant()).not.toBe(0);
    expect(openingMatrix(new Matrix4(), window, 'broken', 0, false).determinant()).toBe(0);
    expect(openingMatrix(new Matrix4(), window, 'open', 0, false).determinant()).toBe(0);
  });
});

describe('OpeningsView events', () => {
  const view = new OpeningsView({} as never, {} as never);
  it('tracks pressure levels and state changes', () => {
    view.applyEvents([
      { type: 'openingPressure', tx: 10, ty: 24, z: 0, side: 'n', level: 2 } as never,
    ]);
    expect(view.pressureLevel(10, 24, 0, 'n')).toBe(2);
    view.applyEvents([
      { type: 'openingPressure', tx: 10, ty: 24, z: 0, side: 'n', level: 7 } as never,
    ]);
    expect(view.pressureLevel(10, 24, 0, 'n')).toBe(3);
    view.applyEvents([
      { type: 'openingChanged', tx: 10, ty: 24, z: 0, side: 'n', state: 'broken' } as never,
    ]);
    expect(view.state(10, 24, 0, 'n')).toBe('broken');
    expect(view.pressureLevel(10, 24, 0, 'n')).toBe(0);
    view.setStates([]);
    expect(view.state(10, 24, 0, 'n')).toBe('closed');
  });
});
