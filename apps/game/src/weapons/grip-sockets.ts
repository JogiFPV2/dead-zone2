import { AxesHelper, Group, Matrix4, Vector3, type Object3D } from 'three';

/**
 * Grip sockets (anim-spec §4): an empty Object3D under each wrist bone in which a held item
 * sits. Hand frame: metres (1.6 m character), +Y along the fingers, +Z the thumb side of the
 * fist (forward with the arm hanging); the item's +Y is its long axis;
 * the item's grip point is its origin. Per item category the table below gives the hand(s),
 * offset, rotation and length scale.
 */

/** What can be in a hand (weapons by grip, plus the non-weapon items of anim-spec §3). */
export const HELD_CATEGORIES = [
  'melee1',
  'knife',
  'twoHanded',
  'pistol',
  'rifle',
  'flashlight',
  'food',
  'tool',
  'plank',
  'bag',
] as const;
export type HeldCategory = (typeof HELD_CATEGORIES)[number];

export interface GripSocketSpec {
  /** Hand holding the grip point (the flashlight / food default; the loadout may swap it). */
  hand: 'R' | 'L';
  /** Left hand also on the item at this distance along +Y (IK, two-handed items). */
  leftAt?: number;
  offset: readonly [number, number, number];
  /** Euler XYZ, degrees. */
  rotDeg: readonly [number, number, number];
  /** Length scale (fraction of the content length, or the item size); undefined = model size. */
  scale?: number;
}

/** anim-spec §4 table. */
export const GRIP_SOCKETS: Record<HeldCategory, GripSocketSpec> = {
  melee1: { hand: 'R', offset: [0, -0.02, 0.03], rotDeg: [90, 0, 0] },
  tool: { hand: 'R', offset: [0, -0.02, 0.03], rotDeg: [90, 0, 0] },
  knife: { hand: 'R', offset: [0, -0.02, 0.03], rotDeg: [-90, 0, 0], scale: 0.25 },
  twoHanded: { hand: 'R', leftAt: 0.25, offset: [0, -0.02, 0.03], rotDeg: [80, 0, 10], scale: 1 },
  plank: { hand: 'R', leftAt: 0.25, offset: [0, -0.02, 0.03], rotDeg: [80, 0, 10], scale: 1 },
  pistol: { hand: 'R', offset: [0, 0, 0.04], rotDeg: [0, 0, 0] },
  rifle: { hand: 'R', leftAt: 0.35, offset: [0, 0.01, 0.05], rotDeg: [0, 0, 0], scale: 1 },
  flashlight: { hand: 'L', offset: [0, -0.01, 0.04], rotDeg: [0, 0, 0], scale: 0.2 },
  food: { hand: 'L', offset: [0, -0.03, 0.02], rotDeg: [0, 0, 90], scale: 0.1 },
  bag: { hand: 'R', offset: [0, -0.12, 0], rotDeg: [0, 0, 0] },
};

/** Two-handed items occupy both hands (anim-spec §3 hand rule). */
export const isTwoHanded = (c: HeldCategory): boolean => GRIP_SOCKETS[c].leftAt !== undefined;

/**
 * Wrist bone names to try per side: the spec names `Fist.R` / `Hand.R`; the Quaternius rig in
 * `casual.glb` has `Wrist.R` (glTF dots dropped by three.js: `WristR`).
 */
export const WRIST_NAMES = ['Wrist', 'Fist', 'Hand'] as const;

export function wristBone(root: Object3D, side: 'R' | 'L'): Object3D | undefined {
  for (const n of WRIST_NAMES) {
    const b = root.getObjectByName(`${n}.${side}`) ?? root.getObjectByName(`${n}${side}`);
    if (b) return b;
  }
  return undefined;
}

export interface GripSockets {
  /** Base hand frames (+Y along the fingers, +Z thumb side of the fist). */
  gripR: Group;
  gripL: Group | undefined;
  /** Socket of a category in its hand (child of gripR / gripL). */
  socket(c: HeldCategory, hand?: 'R' | 'L'): Group | undefined;
}

const _p = (o: Object3D): Vector3 => new Vector3().setFromMatrixPosition(o.matrixWorld);
const D = Math.PI / 180;

function handFrame(root: Object3D, side: 'R' | 'L'): Group | undefined {
  const wrist = wristBone(root, side);
  const middle = root.getObjectByName(`Middle2.${side}`) ?? root.getObjectByName(`Middle2${side}`);
  const index = root.getObjectByName(`Index2.${side}`) ?? root.getObjectByName(`Index2${side}`);
  const pinky = root.getObjectByName(`Pinky2.${side}`) ?? root.getObjectByName(`Pinky2${side}`);
  if (!wrist) return undefined;
  const w = _p(wrist);
  const g = new Group();
  g.name = `grip${side}`;
  if (middle && index && pinky) {
    const m = _p(middle);
    const y = m.clone().sub(w).normalize();
    // +Z: thumb side of the fist (pinky → index knuckles, ⟂ the fingers): forward with the arm
    // hanging, so the §4 rotations read as written (90° X: stick forward, knife −90°: back).
    const k = _p(index).sub(_p(pinky)).normalize();
    const z = k.addScaledVector(y, -k.dot(y)).normalize();
    const x = new Vector3().crossVectors(y, z);
    const world = new Matrix4().makeBasis(x, y, z).setPosition(w.lerp(m, 0.8));
    const local = new Matrix4().copy(wrist.matrixWorld).invert().multiply(world);
    local.decompose(g.position, g.quaternion, g.scale);
  }
  wrist.add(g);
  return g;
}

/**
 * Creates `gripR` / `gripL` under the wrist bones from the current pose (call after the first
 * animated pose, like the weapon mounts) and one child socket per category in its hand(s).
 */
export function createGripSockets(root: Object3D): GripSockets | undefined {
  root.updateMatrixWorld(true);
  const gripR = handFrame(root, 'R');
  if (!gripR) return undefined;
  const gripL = handFrame(root, 'L');
  const sockets = new Map<string, Group>();
  for (const c of HELD_CATEGORIES) {
    const s = GRIP_SOCKETS[c];
    for (const side of ['R', 'L'] as const) {
      const parent = side === 'R' ? gripR : gripL;
      if (!parent) continue;
      const g = new Group();
      g.name = `socket:${c}:${side}`;
      // Left hand mirrors x.
      const mx = side === 'R' ? 1 : -1;
      g.position.set(s.offset[0] * mx, s.offset[1], s.offset[2]);
      g.rotation.set(s.rotDeg[0] * D, s.rotDeg[1] * D * mx, s.rotDeg[2] * D * mx);
      parent.add(g);
      sockets.set(`${c}:${side}`, g);
    }
  }
  return {
    gripR,
    gripL,
    socket: (c, hand) => sockets.get(`${c}:${hand ?? GRIP_SOCKETS[c].hand}`),
  };
}

/** Dev `?anim=v2&sockets=1`: small axes on both hand frames (r = x, g = y item, b = z thumb side). */
export function showSocketAxes(s: GripSockets): void {
  for (const g of [s.gripR, s.gripL]) g?.add(new AxesHelper(0.15));
}
