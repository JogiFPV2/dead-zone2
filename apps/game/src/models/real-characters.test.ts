import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHARACTER_CLIPS } from './character-rig.js';
import {
  PLAYER_MODEL,
  REAL_PLAYER_MODEL,
  REAL_ZOMBIE_MODELS,
  ZOMBIE_MODELS,
  characterModels,
} from './model-kit.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../../public/models');

interface GlbJson {
  nodes: { name?: string }[];
  skins: { joints: number[] }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  materials: unknown[];
  animations: { name: string }[];
}

/** JSON chunk of a GLB (no decoding of the meshopt buffers needed). */
function glbJson(id: string): GlbJson {
  const b = readFileSync(join(PUBLIC, `${id}.glb`));
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as GlbJson;
}

describe('characterModels', () => {
  it('keeps the default look on the Quaternius models', () => {
    expect(characterModels('default')).toEqual({ player: PLAYER_MODEL, zombies: ZOMBIE_MODELS });
  });

  it('uses the deadzone-char pack only for render.style = real', () => {
    const real = characterModels('real');
    expect(real.player).toBe(REAL_PLAYER_MODEL);
    expect(real.zombies).toEqual(REAL_ZOMBIE_MODELS);
    expect([real.player, ...real.zombies].every((id) => id.startsWith('deadzone-char/'))).toBe(
      true,
    );
  });
});

describe('deadzone-char models', () => {
  const bones = [
    'Hips',
    'Abdomen',
    'Chest',
    'Head',
    'UpperArm.R',
    'LowerArm.R',
    'Wrist.R',
    'UpperLeg.L',
    'LowerLeg.L',
    'Foot.L',
    'UpperLeg.R',
    'LowerLeg.R',
    'Foot.R',
  ];

  for (const id of [REAL_PLAYER_MODEL, ...REAL_ZOMBIE_MODELS]) {
    it(`${id}: one mesh / material, vertex colours, Quaternius bones, no fingers`, () => {
      const g = glbJson(id);
      expect(g.meshes).toHaveLength(1);
      expect(g.meshes[0]!.primitives).toHaveLength(1);
      expect(g.materials).toHaveLength(1);
      expect(g.meshes[0]!.primitives[0]!.attributes).toHaveProperty('COLOR_0');
      const joints = g.skins[0]!.joints.map((j) => g.nodes[j]!.name);
      for (const b of bones) expect(joints).toContain(b);
      expect(joints.length).toBeLessThanOrEqual(25);
    });
  }

  it('zombies carry every baked clip (idle, walk, run, attack, dead, hit, stagger)', () => {
    const need = ['idle', 'walk', 'run', 'attack', 'dead', 'hit', 'stagger'] as const;
    for (const id of REAL_ZOMBIE_MODELS) {
      const names = glbJson(id).animations.map((a) => a.name);
      for (const a of need) expect(names, `${id} ${a}`).toContain(CHARACTER_CLIPS[a]);
    }
  });

  it('the player carries every character clip', () => {
    const names = glbJson(REAL_PLAYER_MODEL).animations.map((a) => a.name);
    expect(Object.values(CHARACTER_CLIPS).filter((c) => !names.includes(c))).toEqual([]);
  });
});
