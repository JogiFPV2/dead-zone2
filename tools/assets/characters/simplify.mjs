// Decimates `<name>.full.glb` (build-real.py) to `<name>.glb`: weld + meshopt simplify to the
// triangle budget of the plan (players ~4.2k, zombies ~3.8k). Run from tools/assets:
// `node characters/simplify.mjs`.
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { NodeIO } from '@gltf-transform/core';
import { prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const dir = dirname(fileURLToPath(import.meta.url));
const io = new NodeIO();
await MeshoptSimplifier.ready;
for (const f of (await readdir(dir)).filter((x) => x.endsWith('.full.glb')).sort()) {
  const doc = await io.read(join(dir, f));
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const tris = prim.getIndices().getCount() / 3;
  const target = f.startsWith('survivor') ? 4200 : 3800;
  await doc.transform(
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: target / tris,
      error: 0.02,
      lockBorder: false,
    }),
    prune(),
  );
  const after = prim.getIndices().getCount() / 3;
  await io.write(join(dir, f.replace('.full.glb', '.glb')), doc);
  process.stdout.write(`${f} ${tris} -> ${after}\n`);
}
