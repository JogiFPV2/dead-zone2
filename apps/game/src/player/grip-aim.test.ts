import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3, type Object3D } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { placeholderWeapon, type WeaponModels } from '../weapons/weapon-models.js';
import type { WeaponInfo } from '../weapons/weapon-kinds.js';
import { PlayerView } from './player-view.js';

const GLB = join(__dirname, '../../public/models/quaternius-characters/casual.glb');
const models = {
  create: (i: WeaponInfo) => placeholderWeapon(i),
  load: () => Promise.resolve(),
} as unknown as WeaponModels;

async function character() {
  const buf = readFileSync(GLB);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(ab, '');
}

const wpos = (o: Object3D) => new Vector3().setFromMatrixPosition(o.matrixWorld);
const deg = (a: Vector3, b: Vector3) => (a.angleTo(b) * 180) / Math.PI;

/** Player aiming `weapon` with sim facing `facing`; returns world vectors after `frames`. */
async function aimPose(weapon: WeaponInfo, facing: number) {
  const g = await character();
  const view = new PlayerView();
  view.setModel(g.scene, g.animations);
  view.aiming = true;
  let t = 0;
  for (let i = 0; i < 60; i++) {
    view.setWeapons(weapon, undefined, models);
    view.apply({ id: 1, x: 10, y: 10, z: 0, facing }, (t += 16));
  }
  view.root.updateMatrixWorld(true);
  const held = (view as unknown as { held?: { object: Object3D; parent: Object3D } }).held;
  if (!held) throw new Error('no weapon');
  const mount = held.parent;
  const grip = wpos(mount);
  const muzzle = new Vector3(0, weapon.length, 0).applyMatrix4(mount.matrixWorld);
  // Butt end: the grip sits at 30 % of the length from the stock (weapon-models.ts).
  const stock = new Vector3(0, -weapon.length * 0.3, 0).applyMatrix4(mount.matrixWorld);
  const barrel = muzzle.clone().sub(grip).normalize();
  // Body local +X is the facing (player-view.ts).
  const face = new Vector3(1, 0, 0).applyQuaternion(view.root.quaternion).normalize();
  const bone = (n: string) =>
    g.scene.getObjectByName(n) ?? g.scene.getObjectByName(n.replace('.', ''));
  return {
    barrel,
    face,
    grip,
    muzzle,
    stock,
    shoulderR: wpos(bone('UpperArm.R') as Object3D),
    shoulderL: wpos(bone('UpperArm.L') as Object3D),
    head: wpos((bone('Head') ?? bone('Neck')) as Object3D),
    wristL: wpos(bone('Wrist.L') as Object3D),
    mount,
    bone,
  };
}

const rifle: WeaponInfo = {
  id: 'base:hunting-rifle',
  cls: 'firearm',
  knockback: 0,
  length: 0.95,
  grip: 'rifle',
};
const pistol: WeaponInfo = {
  id: 'base:pistol',
  cls: 'firearm',
  knockback: 0,
  length: 0.3,
  grip: 'pistol',
};

describe('aim poses point the barrel where the character faces', () => {
  for (const facing of [0, 1.1, -2.3]) {
    it(`rifle: stock at the right shoulder, barrel along facing ${facing}`, async () => {
      const p = await aimPose(rifle, facing);
      expect(deg(p.barrel, p.face)).toBeLessThan(5);
      // Stock end at the right shoulder (not the chest centre), at about shoulder height.
      expect(p.stock.distanceTo(p.shoulderR)).toBeLessThan(0.12);
      expect(p.stock.distanceTo(p.shoulderR)).toBeLessThan(p.stock.distanceTo(p.shoulderL));
      // Left hand under the handguard.
      const guard = new Vector3(0, 0.16, 0).applyMatrix4(p.mount.matrixWorld);
      expect(p.wristL.distanceTo(guard)).toBeLessThan(0.06);
    });
    it(`rifle: cheek down on the stock, facing ${facing}`, async () => {
      const p = await aimPose(rifle, facing);
      const line = p.muzzle.clone().sub(p.stock).normalize();
      const off = p.head.clone().sub(p.stock);
      const fromLine = off.addScaledVector(line, -off.dot(line));
      // Head (pivot at the jaw) just above the bore line, not beside the chest.
      expect(fromLine.length()).toBeLessThan(0.12);
      expect(fromLine.y).toBeGreaterThan(0);
    });
    it(`pistol: arm out, barrel along facing ${facing}`, async () => {
      const p = await aimPose(pistol, facing);
      expect(deg(p.barrel, p.face)).toBeLessThan(5);
      expect(p.grip.distanceTo(p.shoulderR)).toBeGreaterThan(0.36);
      // Support hand on the gun.
      expect(p.wristL.distanceTo(p.grip)).toBeLessThan(0.09);
    });
  }
});
