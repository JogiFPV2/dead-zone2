import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { describe, expect, it } from 'vitest';

/**
 * Designer's real-scale furniture (`furniture/*.glb`, 1 m = 1 tile, file name = content id
 * without `base:`) must fit the content footprint: the client loads them 1:1 and with footprints
 * on only shrinks them uniformly (`fitFootprint`, height included) when they are larger, so a
 * model wider than its footprint would shrink. Allowed overhang: 0.15 m per tile.
 */
const here = dirname(fileURLToPath(import.meta.url));
const FURNITURE = join(here, '../furniture');
const DATA = join(here, '../../../packages/content/data/base');
const SLACK_PER_TILE = 0.15;

type Fp = { w: number; h: number };

async function contentFootprints(): Promise<Map<string, Fp>> {
  const out = new Map<string, Fp>();
  for (const dir of ['containers', 'items']) {
    for (const f of await readdir(join(DATA, dir))) {
      if (!f.endsWith('.json')) continue;
      const data: unknown = JSON.parse(await readFile(join(DATA, dir, f), 'utf8'));
      const list = Array.isArray(data)
        ? data
        : (Object.values(data as object).find((v): v is unknown[] => Array.isArray(v)) ?? []);
      for (const o of list as { id?: string; footprint?: Fp; placeable?: { footprint?: Fp } }[]) {
        if (typeof o?.id !== 'string') continue;
        const fp = o.footprint ?? o.placeable?.footprint;
        if (!out.has(o.id) || fp) out.set(o.id, fp ?? { w: 1, h: 1 });
      }
    }
  }
  return out;
}

describe('real-scale furniture fits its content footprint', () => {
  it('every furniture/*.glb: width ≤ w + 0.15·w, depth ≤ h + 0.15·h (rot 0, +x along the wall)', async () => {
    const fps = await contentFootprints();
    const io = new NodeIO();
    const files = (await readdir(FURNITURE)).filter((f) => f.endsWith('.glb')).sort();
    expect(files.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const f of files) {
      const id = `base:${f.replace(/\.glb$/, '')}`;
      const fp = fps.get(id);
      if (!fp) {
        problems.push(`${id}: brak w content`);
        continue;
      }
      const doc = await io.read(join(FURNITURE, f));
      const b = getBounds(doc.getRoot().listScenes()[0]!);
      const w = b.max[0] - b.min[0];
      const d = b.max[2] - b.min[2];
      if (w > fp.w * (1 + SLACK_PER_TILE) || d > fp.h * (1 + SLACK_PER_TILE)) {
        problems.push(`${id}: ${w.toFixed(2)}×${d.toFixed(2)} m > footprint ${fp.w}×${fp.h}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('bathtub (1.7 m) is 2×1, so it is never shrunk with footprints on', async () => {
    expect((await contentFootprints()).get('base:bathtub')).toEqual({ w: 2, h: 1 });
  });
});
