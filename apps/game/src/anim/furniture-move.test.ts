import { describe, expect, it } from 'vitest';
import {
  BODY_SETTLE_MS,
  FurnitureMoveAnim,
  furnitureMoveBody,
  type FurnitureMoveAction,
} from './furniture-move.js';
import { RUN_CLIP_SPEED, WALK_CLIP_SPEED, newPose } from './pose.js';

const act = (p: Partial<FurnitureMoveAction> = {}): FurnitureMoveAction => ({
  mode: 'push',
  dirX: 1,
  dirY: 0,
  k: 0.5,
  seconds: 1,
  ...p,
});

describe('furnitureMoveBody (clip from ActionView.furniture)', () => {
  it('push: slow forward step facing dir, leaning in; pull: slow backwards gait facing the piece', () => {
    const push = furnitureMoveBody(act());
    expect(push).toMatchObject({ anim: 'walk', face: 0 });
    expect(push.rate).toBeCloseTo(1 / WALK_CLIP_SPEED);
    expect(push.pitch).toBeGreaterThan(0);
    const pull = furnitureMoveBody(act({ mode: 'pull', dirX: 0, dirY: 1 }));
    expect(pull.anim).toBe('back');
    expect(pull.rate).toBeCloseTo(1 / RUN_CLIP_SPEED);
    expect(pull.pitch).toBeLessThan(0);
    expect(pull.face).toBeCloseTo(-Math.PI / 2);
    expect(furnitureMoveBody(act({ mode: 'pull', k: 1 })).along).toBe(1);
    expect(furnitureMoveBody(act({ k: 1 })).along).toBeCloseTo(0);
    // Longer (heavier) action = slower step.
    expect(furnitureMoveBody(act({ seconds: 2 })).rate).toBeCloseTo(0.5 / WALK_CLIP_SPEED);
  });

  it('rotate: shuffle with a heading swing, heading kept', () => {
    const r = furnitureMoveBody(act({ mode: 'rotate', dirX: 0 }));
    expect(r.twist).toBeGreaterThan(0);
    expect(r.along).toBe(0);
    expect(Number.isNaN(r.face)).toBe(true);
  });
});

describe('FurnitureMoveAnim', () => {
  it('no action: the pose stays as it was', () => {
    const a = new FurnitureMoveAnim();
    const p = newPose();
    p.anim = 'run';
    expect(a.apply(0, 0.016, p)).toBeUndefined();
    expect(p.anim).toBe('run');
  });

  it('pull from the first tick: steps back along dir with the action; ends a tile back', () => {
    const a = new FurnitureMoveAnim();
    const p = newPose();
    a.setAction(act({ mode: 'pull', dirX: -1, k: 0 }), { x: 4.5, y: 5.5 });
    expect(a.apply(0, 0.016, p)).toEqual({ x: 4.5, y: 5.5 });
    expect(p).toMatchObject({ anim: 'back', loop: true });
    a.setAction(act({ mode: 'pull', dirX: -1, k: 0.5 }), { x: 9, y: 9 });
    expect(a.apply(500, 0.016, p)!.x).toBeCloseTo(4);
    a.setAction(act({ mode: 'pull', dirX: -1, k: 1 }), { x: 9, y: 9 });
    expect(a.apply(1000, 0.016, p)!.x).toBeCloseTo(3.5);
    a.completed = true;
    a.setAction(undefined, { x: 3.5, y: 5.5 });
    expect(a.apply(1016, 0.016, p)!.x).toBeCloseTo(3.5);
    expect(a.apply(1016 + BODY_SETTLE_MS, 0.016, p)).toBeUndefined();
    expect(a.current).toBeUndefined();
  });

  it('push: lean forward along dir, settle back on its tile after; interrupted pull: no step', () => {
    const a = new FurnitureMoveAnim();
    const p = newPose();
    a.setAction(act({ k: 0.5 }), { x: 4.5, y: 5.5 });
    expect(a.apply(0, 0.016, p)!.x).toBeGreaterThan(4.5);
    expect(p.anim).toBe('walk');
    expect(p.faceTo).toBe(0);
    a.setAction(undefined, { x: 4.5, y: 5.5 });
    a.apply(10, 0.016, p);
    expect(a.apply(10 + BODY_SETTLE_MS - 1, 0.016, p)!.x).toBeCloseTo(4.5, 2);
    const b = new FurnitureMoveAnim();
    b.setAction(act({ mode: 'pull', k: 0.6 }), { x: 4.5, y: 5.5 });
    b.apply(0, 0.016, p);
    b.setAction(undefined, { x: 4.5, y: 5.5 });
    b.apply(10, 0.016, p);
    expect(b.apply(10 + BODY_SETTLE_MS - 1, 0.016, p)!.x).toBeCloseTo(4.5, 2);
  });
});
