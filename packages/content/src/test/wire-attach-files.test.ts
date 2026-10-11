import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { attachFileSchema } from '../wires/index.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
/** Gdzie mogą leżeć modele słupów i ich `<modelId>.attach.json`. */
const ROOTS = ['apps/game/public/models', 'packages', 'tools/assets'];
const SKIP = new Set(['node_modules', 'dist', '.turbo']);
const SUFFIX = '.attach.json';

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : walk(join(dir, e.name));
    return e.name.endsWith(SUFFIX) ? [join(dir, e.name)] : [];
  });
}

const files = ROOTS.flatMap((r) => walk(join(REPO, r))).map((f) => [relative(REPO, f)]);

describe('pliki *.attach.json w repo', () => {
  it('katalog modeli istnieje (ścieżka testu jest aktualna)', () => {
    expect(existsSync(join(REPO, 'apps/game/public/models'))).toBe(true);
  });
  if (files.length > 0)
    it.each(files)('%s', (rel) => {
      const path = join(REPO, rel);
      const r = attachFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      expect(r.error?.issues ?? [], rel).toEqual([]);
      const modelId = basename(rel, SUFFIX);
      expect(r.data?.modelId, 'modelId = nazwa pliku').toBe(modelId);
      const model = ['.glb', '.gltf'].some((ext) => existsSync(join(dirname(path), modelId + ext)));
      expect(model, `obok leży ${modelId}.glb albo .gltf`).toBe(true);
    });
});
