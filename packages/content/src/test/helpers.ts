import type { PackSource } from '../validate/pack-source.js';

/** Paczka w pamięci: `{ 'items/a.json': [...] }` + manifest z namespace. */
export function memPack(
  id: string,
  files: Record<string, unknown>,
  manifest: Record<string, unknown> = {},
): PackSource {
  return {
    dir: `mem/${id}`,
    files: [
      { path: 'mod.json', json: { id, name: id, version: '1.0.0', ...manifest } },
      ...Object.entries(files).map(([path, json]) => ({ path, json })),
    ],
  };
}

export const knife = {
  id: 'base:knife',
  kind: 'weapon_melee',
  name: 'item.base.knife.name',
  weightKg: 0.3,
  tags: ['base:tool-cutting'],
  melee: {
    category: 'blade_short',
    skill: 'base:blade-short',
    damage: { min: 3, max: 6 },
    rangeTiles: 0.8,
    attacksPerSec: 1.5,
    staminaCost: 1,
    durability: { max: 30 },
  },
};

export const skill = (id: string, group = 'combat') => ({
  id,
  name: `skill.${id.replace(':', '.')}.name`,
  group,
  xpPerLevel: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
});

export const material = (id: string, tags: string[] = []) => ({
  id,
  kind: 'material',
  name: `item.${id.replace(':', '.')}.name`,
  weightKg: 1,
  tags,
});

export const trait = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `trait.${id.replace(':', '.')}.name`,
  polarity: 'positive',
  cost: 2,
  ...extra,
});

/** Minimalna poprawna paczka bazowa do testów walidatora. */
export const miniBase = (extraFiles: Record<string, unknown> = {}) =>
  memPack('base', {
    'skills/combat.json': [skill('base:blade-short'), skill('base:carpentry', 'crafting')],
    'items/weapons.json': [knife],
    'items/materials.json': [material('base:plank', ['base:wood']), material('base:branch')],
    ...extraFiles,
  });
