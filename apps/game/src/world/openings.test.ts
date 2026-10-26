import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  OpeningsView,
  openingMatrix,
  plankMatrix,
  shardMatrix,
  type OpeningEdge,
} from './openings.js';

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

describe('gates, planks and shards (#106)', () => {
  const gate: OpeningEdge = { kind: 'gate', tx: 4, ty: 9, z: 0, side: 'n', building: -1 };
  const pos = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
  const scale = (m: Matrix4) => {
    const s = new Vector3();
    m.decompose(new Vector3(), new Quaternion(), s);
    return s;
  };

  it('a gate leaf sits on its edge closed and swings 90° about the hinge when open', () => {
    const closed = pos(openingMatrix(new Matrix4(), gate, 'closed', 0, false));
    expect(closed.x).toBeCloseTo(4.5, 1);
    expect(closed.z).toBeCloseTo(9, 5);
    const open = pos(openingMatrix(new Matrix4(), gate, 'open', 0, false));
    expect(Math.abs(open.z - 9)).toBeCloseTo(0.48, 2);
    expect(open.x).toBeCloseTo(4.02, 2);
  });

  it('planks: one per count on the outer face, hidden beyond the count', () => {
    const m = new Matrix4();
    expect(scale(plankMatrix(m, door, 0, 2, false)).x).toBeGreaterThan(1);
    expect(scale(plankMatrix(m, door, 1, 2, false)).x).toBeGreaterThan(1);
    expect(plankMatrix(m, door, 2, 2, false).determinant()).toBe(0);
    const ys = [0, 1, 2, 3].map((i) => pos(plankMatrix(m, window, i, 4, false)).y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    // Cutaway: planks above the lowered wall go.
    expect(plankMatrix(m, door, 3, 4, true).determinant()).toBe(0);
  });

  it('shards only in a broken frame that still has glass', () => {
    const m = new Matrix4();
    expect(scale(shardMatrix(m, window, 0, true, false)).y).toBeGreaterThan(0);
    expect(shardMatrix(m, window, 0, false, false).determinant()).toBe(0);
  });

  it('tracks planks and glass from views and events', () => {
    const view = new OpeningsView({} as never, {} as never);
    view.setStates([
      {
        tx: 1,
        ty: 2,
        z: 0,
        side: 'w',
        kind: 'window',
        state: 'broken',
        hp: 0,
        maxHp: 0,
        barricade: 3,
        glass: false,
      },
    ]);
    expect(view.info(1, 2, 0, 'w')).toEqual({ state: 'broken', barricade: 3, glass: false });
    view.applyEvents([
      {
        type: 'openingChanged',
        tx: 1,
        ty: 2,
        z: 0,
        side: 'w',
        state: 'broken',
        barricade: 0,
        glass: false,
      } as never,
    ]);
    expect(view.info(1, 2, 0, 'w').barricade).toBe(0);
  });

  it('info carries the window cover from the view list (protocol 47); a new list clears it', () => {
    const view = new OpeningsView({} as never, {} as never);
    const cover = { item: 'base:blanket', lightPass: 0.1, blocksSight: true };
    const base = {
      tx: 4,
      ty: 5,
      z: 0,
      side: 'n' as const,
      kind: 'window' as const,
      hp: 0,
      maxHp: 0,
    };
    view.setStates([{ ...base, state: 'closed', barricade: 0, glass: true, cover }]);
    expect(view.info(4, 5, 0, 'n').cover).toEqual(cover);
    view.setStates([{ ...base, state: 'closed', barricade: 0, glass: true }]);
    expect(view.info(4, 5, 0, 'n').cover).toBeUndefined();
  });
});
