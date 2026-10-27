// @vitest-environment happy-dom
import type { InstancedMesh } from 'three';
import { expect, it } from 'vitest';
import { NIGHT_PRESET } from './preset.js';
import { StreetLamps, type LampDef } from './street-lamps.js';
import { lampsAt } from '../world/town/decor.js';

const lamp = (x: number, working = true): LampDef => ({ x, z: 0, armX: 0, armZ: 1, working });

it('setLamps swaps the lamp list (generated maps follow the player), same 3 meshes', () => {
  const s = new StreetLamps([lamp(0), lamp(10, false)]);
  s.apply(NIGHT_PRESET.lamps);
  const count = (name: string) => (s.root.getObjectByName(name) as InstancedMesh).count;
  expect(count('lamp-body')).toBe(2);
  expect(count('lamp-bulbs')).toBe(1);
  s.setLamps([lamp(500), lamp(510), lamp(520)]);
  expect(count('lamp-body')).toBe(3);
  expect(count('lamp-bulbs')).toBe(3);
  expect(s.root.children.filter((c) => c.name.startsWith('lamp-') && 'count' in c)).toHaveLength(3);
  s.update(505, 0);
  expect(s.litLamps.length).toBeGreaterThan(0);
  s.dispose();
});

it('lampsAt puts lamps on the curb side of an east-west street', () => {
  const f = (x: number, z: number) =>
    z === 1 ? 'base:asphalt' : z === 0 ? 'base:sidewalk' : 'base:grass';
  const out: LampDef[] = [];
  for (let x = 0; x < 72; x++) lampsAt(f, x, 0, out);
  expect(out).toHaveLength(4);
  expect(out.every((l) => l.armZ === 1)).toBe(true);
});

it('lampsAt: no lamp on or right by the track bed (Paweł 27.10)', () => {
  // Same street, a railway across it at x = 37..40 (the lamp at x = 36 stood 1 m from it).
  const f = (x: number, z: number) =>
    x >= 37 && x <= 40
      ? 'base:rail'
      : z === 1
        ? 'base:asphalt'
        : z === 0
          ? 'base:sidewalk'
          : 'base:grass';
  const out: LampDef[] = [];
  for (let x = 0; x < 72; x++) lampsAt(f, x, 0, out);
  expect(out.map((l) => l.x)).toEqual([0.5, 18.5, 54.5]);
});
