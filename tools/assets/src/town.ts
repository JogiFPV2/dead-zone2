import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import type { Accessor, NodeIO } from '@gltf-transform/core';

type Arr = Float32Array | Uint32Array | Uint16Array | Uint8Array | Int16Array | Int8Array;
/** Copy of an accessor's data (the typed array type does not resolve for lint). */
const copy = (a: Accessor): Arr => (a.getArray() as unknown as Arr).slice();
import { optimize } from './optimize.js';

/** Designer's town handoff (`deadzone-town-assets/manifest.json`). */
interface TownSource {
  atlas: {
    file: string;
    size: number;
    grid: number;
    cells: { name: string; hex: string; uv: [number, number] }[];
  };
  emissive: { file: string };
  models: { id: string; file: string; triangles: number }[];
}

/** Runtime index of the town kit (`deadzone-town/town.json`). */
export interface TownKitIndex {
  version: 1;
  glb: string;
  palette: string;
  emissive: string;
  detail: string;
  /** Atlas cell name -> [u, v] (cell centre) and hex colour. */
  cells: Record<string, { uv: [number, number]; hex: string }>;
  /** Module name (mesh name in the GLB) -> triangle count. */
  modules: Record<string, number>;
}

/**
 * Bundles the town modules (walls, windows, doors, roofs, props; CC0 Kenney kits converted to
 * one flat-colour atlas by the Designer) into ONE meshopt GLB with a mesh per module, plus the
 * palette, emissive mask and terrain detail textures and a small JSON index.
 * One fetch instead of 64; the game builds BatchedMeshes from the geometries.
 */
export async function bundleTown(
  io: NodeIO,
  srcDir: string,
  outDir: string,
): Promise<TownKitIndex> {
  const src = JSON.parse(await readFile(join(srcDir, 'manifest.json'), 'utf8')) as TownSource;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('town');
  const material = doc
    .createMaterial('deadzone-town/palette')
    .setRoughnessFactor(1)
    .setMetallicFactor(0);
  const modules: Record<string, number> = {};
  for (const m of [...src.models].sort((a, b) => a.id.localeCompare(b.id))) {
    const name = m.id.split('/')[1] ?? m.id;
    const part = await io.read(join(srcDir, m.file));
    const mesh = doc.createMesh(name);
    for (const srcMesh of part.getRoot().listMeshes()) {
      for (const p of srcMesh.listPrimitives()) {
        const pos = p.getAttribute('POSITION');
        const uv = p.getAttribute('TEXCOORD_0');
        if (!pos || !uv) continue;
        const prim = doc
          .createPrimitive()
          .setMaterial(material)
          .setAttribute(
            'POSITION',
            doc.createAccessor().setType('VEC3').setArray(copy(pos)).setBuffer(buffer),
          )
          .setAttribute(
            'TEXCOORD_0',
            doc.createAccessor().setType('VEC2').setArray(copy(uv)).setBuffer(buffer),
          );
        const idx = p.getIndices();
        if (idx)
          prim.setIndices(
            doc.createAccessor().setType('SCALAR').setArray(copy(idx)).setBuffer(buffer),
          );
        mesh.addPrimitive(prim);
      }
    }
    scene.addChild(doc.createNode(name).setMesh(mesh));
    modules[name] = m.triangles;
  }
  await optimize(doc);
  await mkdir(outDir, { recursive: true });
  await io.write(join(outDir, 'town.glb'), doc);
  await copyFile(join(srcDir, src.atlas.file), join(outDir, 'palette.png'));
  await copyFile(join(srcDir, src.emissive.file), join(outDir, 'palette-emissive.png'));
  // Lossy re-encode (webp q75, 320 kB) when present; the lossless original is 0.8 MB.
  const lossy = join(srcDir, 'textures/terrain-detail-q75.webp');
  const detail = (await stat(lossy).catch(() => undefined))
    ? lossy
    : join(srcDir, 'textures/terrain-detail.webp');
  await copyFile(detail, join(outDir, 'terrain-detail.webp'));
  const index: TownKitIndex = {
    version: 1,
    glb: 'deadzone-town/town.glb',
    palette: 'deadzone-town/palette.png',
    emissive: 'deadzone-town/palette-emissive.png',
    detail: 'deadzone-town/terrain-detail.webp',
    cells: Object.fromEntries(
      src.atlas.cells
        .filter((c) => !c.name.startsWith('_'))
        .map((c) => [c.name, { uv: c.uv, hex: c.hex }]),
    ),
    modules,
  };
  await writeFile(join(outDir, 'town.json'), JSON.stringify(index, null, 2) + '\n');
  const bytes = (await stat(join(outDir, 'town.glb'))).size;
  console.log(`town.glb: ${Object.keys(modules).length} modułów, ${(bytes / 1024).toFixed(1)} kB`);
  return index;
}
