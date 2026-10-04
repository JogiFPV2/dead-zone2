import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnimationMixer, Vector3, type AnimationClip, type Object3D } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import type { Gait } from '@deadzone/protocol';
import { fitted } from '../models/model-kit.js';
import { PLAYER_HEIGHT } from '../player/player-view.js';
import { LegPose } from './leg-pose.js';
import {
  GAIT_SPEED,
  LocoBlend,
  RUN_CLIP,
  WALK_CLIP,
  clipTime,
  type LocoClip,
} from './locomotion-blend.js';

const GLB = join(__dirname, '../../public/models/quaternius-characters/casual.glb');
const DT = 1 / 60;

async function character() {
  const buf = readFileSync(GLB);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(ab, '');
  const root = fitted(g.scene, PLAYER_HEIGHT);
  const bone = (n: string) =>
    (g.scene.getObjectByName(n) ?? g.scene.getObjectByName(n.replace('.', ''))) as Object3D;
  const clip = (name: string) =>
    g.animations.find((a) => a.name.split('|').pop() === name) as AnimationClip;
  return { root, model: g.scene, bone, clip };
}

type Rig = Awaited<ReturnType<typeof character>>;

/** Plays `clip` at clip time `t` and returns both feet in world space. */
function feetAt(rig: Rig, mixer: AnimationMixer, t: number, legs?: LegPose, gain = 1) {
  mixer.setTime(t);
  rig.root.updateMatrixWorld(true);
  legs?.apply({ gain, crouch: 0, right: new Vector3(-1, 0, 0) });
  rig.root.updateMatrixWorld(true);
  return {
    l: rig.bone('Foot.L').getWorldPosition(new Vector3()),
    r: rig.bone('Foot.R').getWorldPosition(new Vector3()),
  };
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
/** Horizontal speed of the lower (planted) foot between two samples. */
function stanceSpeed(
  a: { l: Vector3; r: Vector3 },
  b: { l: Vector3; r: Vector3 },
  dt: number,
): number | undefined {
  const leftDown = a.l.y < a.r.y && b.l.y < b.r.y;
  const rightDown = a.r.y < a.l.y && b.r.y < b.l.y;
  if (!leftDown && !rightDown) return undefined;
  const p = leftDown ? a.l : a.r;
  const q = leftDown ? b.l : b.r;
  return Math.hypot(q.x - p.x, q.z - p.z) / dt;
}

async function measure(name: string) {
  const rig = await character();
  const clip = rig.clip(name);
  const mixer = new AnimationMixer(rig.model);
  mixer.clipAction(clip).play();
  const n = 240;
  const step = clip.duration / n;
  const samples = Array.from({ length: n + 1 }, (_, i) => feetAt(rig, mixer, i * step));
  const speeds: number[] = [];
  let contact: number | undefined;
  for (let i = 1; i <= n; i++) {
    const s = stanceSpeed(samples[i - 1]!, samples[i]!, step);
    if (s !== undefined) speeds.push(s);
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (contact === undefined && a.l.y >= a.r.y && b.l.y < b.r.y) contact = i / n;
  }
  return { duration: clip.duration, speed: median(speeds), contact: contact ?? 0 };
}

const cyc = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

describe(
  'locomotion clips vs. constants (casual.glb at PLAYER_HEIGHT)',
  { timeout: 60_000 },
  () => {
    it.each([
      ['Walk', WALK_CLIP],
      ['Run', RUN_CLIP],
    ] as const)('%s: duration, stance-foot speed and left contact', async (name, c) => {
      const m = await measure(name);
      expect(m.duration).toBeCloseTo(c.duration, 2);
      expect(Math.abs(m.speed - c.speed) / c.speed).toBeLessThan(0.1);
      expect(cyc(m.contact, c.leftContact)).toBeLessThan(0.06);
    });
  },
);

/** Runs the blend at a steady speed, then plays one clip at the shared phase with stride gain. */
async function plantedFootSpeed(speed: number, gait: Gait, clipName: string, clip: LocoClip) {
  const rig = await character();
  const legs = new LegPose(rig.model);
  const mixer = new AnimationMixer(rig.model);
  mixer.clipAction(rig.clip(clipName)).play();
  const blend = new LocoBlend();
  for (let i = 0; i < 180; i++) blend.update({ speed, accel: 0, gait, yawRate: 0, dt: DT });
  const speeds: number[] = [];
  let prev: { l: Vector3; r: Vector3 } | undefined;
  for (let i = 0; i < 240; i++) {
    const p = blend.update({ speed, accel: 0, gait, yawRate: 0, dt: DT });
    const cur = feetAt(rig, mixer, clipTime(clip, p.phase), legs, p.gain);
    if (prev) {
      const s = stanceSpeed(prev, cur, DT);
      if (s !== undefined && s < speed * 3) speeds.push(s);
    }
    prev = cur;
  }
  return median(speeds);
}

describe('planted foot does not slide', { timeout: 120_000 }, () => {
  it.each([
    [GAIT_SPEED.sneak, 'sneak', 'Walk', WALK_CLIP],
    [GAIT_SPEED.walk, 'walk', 'Walk', WALK_CLIP],
    [GAIT_SPEED.run, 'run', 'Run', RUN_CLIP],
    [GAIT_SPEED.sprint, 'sprint', 'Run', RUN_CLIP],
  ] as const)('%s m/s (%s)', async (speed, gait, name, clip) => {
    const foot = await plantedFootSpeed(speed, gait, name, clip);
    expect(Math.abs(foot - speed) / speed).toBeLessThan(0.1);
  });
});

describe('LocoBlend', () => {
  const run = (b: LocoBlend, speed: number, gait: Gait, frames: number, accel = 0, yawRate = 0) => {
    for (let i = 0; i < frames; i++) b.update({ speed, accel, gait, yawRate, dt: DT });
    return b.pose;
  };

  it('blends walk → run by real speed; sneak always walks and crouches', () => {
    expect(run(new LocoBlend(), 1.5, 'walk', 120).run).toBe(0);
    expect(run(new LocoBlend(), 3.75, 'run', 120).run).toBeCloseTo(1, 3);
    // A run order while still slow keeps walking steps.
    expect(run(new LocoBlend(), 1.2, 'run', 120).run).toBe(0);
    const s = run(new LocoBlend(), 0.75, 'sneak', 120);
    expect(s.run).toBe(0);
    expect(s.crouch).toBeGreaterThan(0.95);
  });

  it('cadence follows speed: the phase slows down while braking', () => {
    const b = new LocoBlend();
    run(b, 3.75, 'run', 120);
    const rate = (speed: number) => {
      const p0 = b.pose.phase;
      b.update({ speed, accel: 0, gait: 'run', yawRate: 0, dt: DT });
      return (b.pose.phase - p0 + 1) % 1;
    };
    const fast = rate(3.75);
    run(b, 1.5, 'walk', 120, -4);
    const slow = rate(1.5);
    expect(slow).toBeLessThan(fast);
    run(b, 0, 'walk', 120);
    const p = b.pose.phase;
    run(b, 0, 'walk', 30);
    expect(b.pose.phase).toBe(p);
    expect(b.pose.moving).toBe(false);
  });

  it('sprint: longer stride and forward pitch; accel leans, turns bank', () => {
    const r = run(new LocoBlend(), 3.75, 'run', 120);
    const s = run(new LocoBlend(), 4.875, 'sprint', 120);
    expect(s.sprint).toBeGreaterThan(0.9);
    expect(s.gain).toBeGreaterThan(r.gain);
    expect(s.pitch).toBeGreaterThan(r.pitch + 0.1);
    expect(run(new LocoBlend(), 1.5, 'walk', 120, 3).pitch).toBeGreaterThan(0.05);
    expect(run(new LocoBlend(), 1.5, 'walk', 120, -3).pitch).toBeLessThan(-0.05);
    expect(run(new LocoBlend(), 3.75, 'run', 120, 0, 2).roll).toBeGreaterThan(0.1);
    expect(run(new LocoBlend(), 3.75, 'run', 120, 0, -2).roll).toBeLessThan(-0.1);
  });
});

describe('LegPose (IK legs)', { timeout: 60_000 }, () => {
  const right = new Vector3(-1, 0, 0);
  /** Gap between each shin end and its foot (m). */
  const gaps = (rig: Rig) =>
    (['L', 'R'] as const).map((s) => {
      const lower = rig.bone(`LowerLeg.${s}`);
      const foot = rig.bone(`Foot.${s}`).getWorldPosition(new Vector3());
      // The shin bone points at its end: nearest point on its axis ray to the foot.
      const o = lower.getWorldPosition(new Vector3());
      const axis = new Vector3(0, 1, 0).transformDirection(lower.matrixWorld);
      const along = foot.clone().sub(o).dot(axis);
      return foot.distanceTo(o.addScaledVector(axis, along));
    });

  it('crouch: pelvis down, feet stay, knees forward, ankles on the feet', async () => {
    const rig = await character();
    const legs = new LegPose(rig.model);
    const mixer = new AnimationMixer(rig.model);
    mixer.clipAction(rig.clip('Idle')).play();
    mixer.setTime(0.2);
    rig.root.updateMatrixWorld(true);
    const y = (n: string) => rig.bone(n).getWorldPosition(new Vector3());
    const f0 = y('Foot.L');
    const h0 = y('Hips').y;
    legs.apply({ gain: 1, crouch: 1, right });
    rig.root.updateMatrixWorld(true);
    expect(y('Foot.L').distanceTo(f0)).toBeLessThan(1e-6);
    expect(y('Hips').y).toBeLessThan(h0 - 0.1);
    expect(y('LowerLeg.L').z).toBeGreaterThan(y('UpperLeg.L').z + 0.05);
    for (const g of gaps(rig)) expect(g).toBeLessThan(0.01);
    // Standing again (no clip track resets the pelvis here): the drop is undone.
    legs.apply({ gain: 1, crouch: 0, right });
    rig.root.updateMatrixWorld(true);
    expect(y('Hips').y).toBeCloseTo(h0, 3);
    // Repeated frames do not add up the spine bend (Idle has no Abdomen track).
    const spine = rig.bone('Abdomen');
    legs.apply({ gain: 1, crouch: 1, right });
    const q1 = spine.quaternion.clone();
    for (let n = 0; n < 5; n++) legs.apply({ gain: 1, crouch: 1, right });
    expect(spine.quaternion.angleTo(q1)).toBeLessThan(1e-2);
  });

  it('stride gain keeps the ankles on the moved feet', async () => {
    const rig = await character();
    const legs = new LegPose(rig.model);
    const mixer = new AnimationMixer(rig.model);
    mixer.clipAction(rig.clip('Run')).play();
    for (const t of [0.1, 0.3, 0.5, 0.7]) {
      mixer.setTime(t);
      rig.root.updateMatrixWorld(true);
      legs.apply({ gain: 1.3, crouch: 0, right });
      rig.root.updateMatrixWorld(true);
      for (const g of gaps(rig)) expect(g).toBeLessThan(0.01);
    }
  });
});
