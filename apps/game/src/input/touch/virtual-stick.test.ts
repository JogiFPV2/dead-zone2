import { describe, expect, it } from 'vitest';
import { moveDirection } from '../move-direction.js';
import {
  IDLE_STICK,
  STICK_DEAD_ZONE,
  STICK_RADIUS_PX,
  STICK_RUN_AT,
  VirtualStick,
  stickMove,
  stickVector,
} from './virtual-stick.js';

const R = STICK_RADIUS_PX;

describe('virtual joystick', () => {
  it('mockup sizes: ring Ø120, dead zone 12 %, run above 90 %', () => {
    expect(R * 2).toBe(120);
    expect(STICK_DEAD_ZONE).toBe(0.12);
    expect(STICK_RUN_AT).toBe(0.9);
  });

  it('dead zone: small offsets are idle, just outside starts from 0', () => {
    expect(stickVector(0, 0)).toBe(IDLE_STICK);
    expect(stickVector(R * 0.11, 0)).toBe(IDLE_STICK);
    const v = stickVector(R * 0.13, 0);
    expect(v.mag).toBeGreaterThan(0);
    expect(v.mag).toBeLessThan(0.02);
    expect(v.run).toBe(false);
  });

  it('rescales to 0..1 and clamps past the rim', () => {
    const half = stickVector(0, R * (STICK_DEAD_ZONE + (1 - STICK_DEAD_ZONE) / 2));
    expect(half.mag).toBeCloseTo(0.5);
    expect(half.y).toBeCloseTo(0.5);
    const far = stickVector(R * 3, R * 4);
    expect(far.mag).toBeCloseTo(1);
    expect(far.x).toBeCloseTo(0.6);
    expect(far.y).toBeCloseTo(0.8);
  });

  it('run threshold: above 90 % of the radius runs, 90 % and below walks', () => {
    expect(stickVector(R * 0.9, 0).run).toBe(false);
    expect(stickVector(R * 0.91, 0).run).toBe(true);
    expect(stickVector(R * 2, 0).run).toBe(true);
  });

  it('maps like WASD for the camera yaw; partial = slower walk, full = run at length 1', () => {
    for (const yaw of [0, Math.PI / 4, -Math.PI / 2, 2]) {
      const up = stickMove(stickVector(0, -R), yaw);
      const w = moveDirection({ up: true, down: false, left: false, right: false }, yaw);
      expect(up.gait).toBe('run');
      expect(up.dx).toBeCloseTo(w.dx, 1);
      expect(up.dy).toBeCloseTo(w.dy, 1);
      const right = stickMove(stickVector(R, 0), yaw);
      const d = moveDirection({ up: false, down: false, left: false, right: true }, yaw);
      expect(right.dx).toBeCloseTo(d.dx, 1);
      expect(right.dy).toBeCloseTo(d.dy, 1);
    }
    const slow = stickMove(stickVector(0, -R * 0.5), 0);
    expect(slow.gait).toBe('walk');
    expect(Math.hypot(slow.dx, slow.dy)).toBeLessThan(0.6);
    expect(stickMove(IDLE_STICK, 1)).toEqual({ dx: 0, dy: 0, gait: 'walk' });
  });

  it('floating stick: centre where the finger lands, one finger owns it, lift = idle', () => {
    const s = new VirtualStick();
    s.start(7, 100, 200);
    expect(s.active).toBe(true);
    s.move(7, 100 + R, 200);
    expect(s.vector.mag).toBeCloseTo(1);
    expect(s.knob).toMatchObject({ cx: 100, cy: 200 });
    expect(s.knob.dx).toBeCloseTo(R);
    s.move(8, 100, 200); // another finger
    expect(s.vector.mag).toBeCloseTo(1);
    s.end(8);
    expect(s.active).toBe(true);
    s.end(7);
    expect(s.active).toBe(false);
    expect(s.vector).toBe(IDLE_STICK);
  });
});
