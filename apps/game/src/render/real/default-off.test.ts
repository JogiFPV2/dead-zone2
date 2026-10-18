import { describe, expect, it } from 'vitest';
import { parseBootOptions } from '../../boot-options.js';

/**
 * `render.style` defaults to today's look and the realistic path must not touch it: nothing of
 * `render/real` is imported, loaded or drawn unless `?style=real` (guard for the pilot).
 */
const SOURCES = import.meta.glob<string>(
  ['../../game.ts', '../../world/town/town-terrain.ts', '../../world/gen/streamed-town.ts'],
  { query: '?raw', import: 'default', eager: true },
);
const src = (p: string): string => {
  const s = SOURCES[p];
  if (s === undefined) throw new Error(`missing source ${p}`);
  return s;
};

describe('realistic style is off by default', () => {
  it('boot options default to the current look', () => {
    expect(parseBootOptions('').render).toEqual({ style: 'default', quality: 'medium' });
    expect(parseBootOptions('?quality=high').render.style).toBe('default');
  });

  it('game.ts: real style only loaded behind the flag, default frame = style pass', () => {
    const game = src('../../game.ts');
    // Only a lazy import, gated by the flag (no static import of render/real).
    expect(game).not.toMatch(/^import .*render\/real/m);
    expect(game).toMatch(
      /const realStyle =\s*boot\.render\.style === 'real'\s*\?\s*await import\('\.\/render\/real\/real-style\.js'\)[\s\S]*?:\s*undefined;/,
    );
    // Off: the frame is exactly the old call.
    expect(game).toMatch(
      /const drawFrame = realStyle\s*\?\s*\(\) => realStyle\.render\(\)\s*:\s*\(\) => stylePass\.render\(scene, camera\);/,
    );
    // Off: the kit passes through unchanged; every other hook is optional-chained or guarded.
    expect(game).toContain('.then((kit) => (realStyle ? realStyle.townKit(kit) : kit))');
    expect(game).toContain('realStyle?.afterLighting();');
    expect(game).toContain('realStyle?.setSize(width, height);');
    expect(game).toMatch(/if \(realStyle\) \{\n\s+realStyle\.attach\(/);
  });

  it('terrain keeps its own material unless the kit brings one', () => {
    for (const p of ['../../world/town/town-terrain.ts', '../../world/gen/streamed-town.ts']) {
      expect(src(p)).toMatch(/kit\.terrainMaterial \?\? terrainMaterial\(kit\.detail\)/);
    }
  });
});
