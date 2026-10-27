import { Bone, Group } from 'three';
import { describe, expect, it } from 'vitest';
import { ANIM_V2_DEFAULT, animV2Enabled } from '../anim/contract.js';
import {
  GRIP_SOCKETS,
  HELD_CATEGORIES,
  createGripSockets,
  isTwoHanded,
  wristBone,
} from './grip-sockets.js';

function rig(wrist = 'Wrist'): Group {
  const root = new Group();
  for (const side of ['R', 'L'] as const) {
    const s = side === 'R' ? 1 : -1;
    const w = new Bone();
    w.name = `${wrist}${side}`;
    w.position.set(0.5 * s, 1, 0);
    root.add(w);
    for (const [n, z] of [
      ['Middle2', 0],
      ['Index2', 0.03],
      ['Pinky2', -0.03],
    ] as const) {
      const b = new Bone();
      b.name = `${n}${side}`;
      b.position.set(0.1 * s, 0, z);
      w.add(b);
    }
  }
  return root;
}

describe('anim v2 flag', () => {
  it('off by default, ?anim=v2 turns it on', () => {
    expect(ANIM_V2_DEFAULT).toBe(false);
    expect(animV2Enabled('')).toBe(false);
    expect(animV2Enabled('?anim=v2&touch=1')).toBe(true);
    expect(animV2Enabled('?anim=v1')).toBe(false);
  });
});

describe('grip sockets', () => {
  it('every category has a socket; two-handed items take both hands', () => {
    for (const c of HELD_CATEGORIES) expect(GRIP_SOCKETS[c]).toBeDefined();
    expect(HELD_CATEGORIES.filter(isTwoHanded).sort()).toEqual(['plank', 'rifle', 'twoHanded']);
    expect(GRIP_SOCKETS.flashlight.hand).toBe('L');
    expect(GRIP_SOCKETS.food.hand).toBe('L');
    expect(GRIP_SOCKETS.pistol.hand).toBe('R');
  });

  it('gripR / gripL under the wrist bones, one socket per category and hand', () => {
    const s = createGripSockets(rig())!;
    expect(s.gripR.parent?.name).toBe('WristR');
    expect(s.gripL?.parent?.name).toBe('WristL');
    for (const c of HELD_CATEGORIES) {
      expect(s.socket(c)?.parent).toBe(GRIP_SOCKETS[c].hand === 'R' ? s.gripR : s.gripL);
      expect(s.socket(c, 'L')?.parent).toBe(s.gripL);
    }
    // Hand frame: +Y along the fingers (towards Middle2).
    s.gripR.updateMatrixWorld(true);
    const e = s.gripR.matrixWorld.elements;
    expect(e[4]).toBeCloseTo(1);
  });

  it('finds Fist / Hand bones too, undefined without a wrist', () => {
    expect(wristBone(rig('Fist'), 'R')?.name).toBe('FistR');
    expect(wristBone(rig('Hand'), 'L')?.name).toBe('HandL');
    expect(createGripSockets(new Group())).toBeUndefined();
  });
});
