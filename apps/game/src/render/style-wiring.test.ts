import { Bone, BoxGeometry, Group, MeshStandardMaterial, Skeleton, SkinnedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { GRAPHICS_STYLES } from '../settings/schema.js';
import { addHulls } from './style-materials.js';

/**
 * Guard against the renderer being dropped again (#72 reverted #71: the „Styl grafiki” setting
 * was saved but nothing drew it). Every frame of the game and the menu background goes through
 * `GraphicsStylePass`, which is fed from `settings.graphics.style`.
 */
const SOURCES = import.meta.glob<string>(
  ['../game.ts', '../menu/menu-scene.ts', '../menu/boot-menu.ts'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);
const src = (p: string): string => {
  const s = SOURCES[p];
  if (s === undefined) throw new Error(`missing source ${p}`);
  return s;
};

describe('graphics style wiring (regression: style setting had no effect)', () => {
  it('game renders every frame through the style pass driven by the setting', () => {
    const game = src('../game.ts');
    expect(game).toContain('new GraphicsStylePass(renderer)');
    expect(game).toContain('stylePass.setStyle(settings.get().graphics.style)');
    expect(game).toMatch(
      /settings\.subscribe\(\(next\) => stylePass\.setStyle\(next\.graphics\.style\)\)/,
    );
    expect(game).toContain('stylePass.render(scene, camera)');
    expect(game).not.toMatch(/renderer\.render\(\s*scene/);
    expect(game).toContain('addHulls(p.object)');
  });

  it('menu background previews the style live', () => {
    const scene = src('../menu/menu-scene.ts');
    expect(scene).toContain('stylePass.setStyle(style())');
    expect(scene).toContain('stylePass.render(scene, camera)');
    expect(scene).not.toMatch(/renderer\.render\(\s*scene/);
    expect(src('../menu/boot-menu.ts')).toContain('settings.get().graphics.style');
  });

  it('keeps the three styles and appends „Pikselowy ostry”', () => {
    expect([...GRAPHICS_STYLES]).toEqual(['classic', 'outline', 'pixel', 'pixel-fine']);
  });

  it('adds one hull per skinned part, as its child, idempotently', () => {
    const bone = new Bone();
    const part = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial());
    part.add(bone);
    part.bind(new Skeleton([bone]));
    const root = new Group().add(part);
    addHulls(root);
    addHulls(root);
    const hulls = part.children.filter((c) => c.userData.dzHull);
    expect(hulls).toHaveLength(1);
  });
});
