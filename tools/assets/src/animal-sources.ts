import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Document, NodeIO, Primitive } from '@gltf-transform/core';
import { meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { PNG } from 'pngjs';
import { ready } from './optimize.js';

/**
 * Offline step for the animal sources that only exist as FBX/.blend (no GLB download): converts
 * them with FBX2glTF (env `FBX2GLTF`, the binary of the `fbx2gltf` npm package; not needed on CI)
 * and cleans them up into `tools/assets/animals/<name>.glb`, which the `animals-*` packs list
 * as committed files (`files[].path`). `src` is a directory with the extracted downloads:
 * - `Animal Pack Vol.2 by @Quaternius/FBX/{Cat,Eagle}.fbx` (opengameart.org, CC0),
 * - `rabbit.fbx` + `texture/rabbit-skinn.png` from `rabbit-FBX.7z` (opengameart.org, CC0),
 * - `genuinely-my-pigeon-extended-furthur.blend` (opengameart.org, CC0), exported with Blender
 *   4.2 (env `BLENDER`) by `animals/pigeon-export.py`, which adds the perched clip.
 * Colours are set at runtime (`apps/game/src/animals/animal-species.ts`), by material name.
 */
interface Source {
  name: string;
  /** FBX source (FBX2glTF) … */
  fbx?: string;
  /** … or a .blend exported by a Blender script from `tools/assets/animals/` (env BLENDER). */
  blend?: { file: string; script: string };
  /**
   * Base colours by material name (sRGB hex, from the game palette): the FBX files carry grey
   * placeholders only, and identical materials would be merged by the pipeline's dedup.
   */
  colours?: Record<string, number>;
  /** Final edit of the converted document. */
  edit?: (doc: Document, src: string) => Promise<void> | void;
}

const SOURCES: Source[] = [
  {
    name: 'cat',
    fbx: 'Animal Pack Vol.2 by @Quaternius/FBX/Cat.fbx',
    // Grey tabby.
    colours: { Grey: 0x5e6170, White: 0xc8cacf, Pink: 0xc08a62 },
  },
  {
    name: 'pigeon',
    blend: { file: 'genuinely-my-pigeon-extended-furthur.blend', script: 'pigeon-export.py' },
    edit: (doc) => {
      const root = doc.getRoot();
      for (const mesh of root.listMeshes())
        for (const prim of mesh.listPrimitives()) {
          for (const k of ['COLOR_1', 'TEXCOORD_0']) prim.setAttribute(k, null);
          paintByBones(
            doc,
            prim,
            root
              .listSkins()[0]
              ?.listJoints()
              .map((j) => j.getName()) ?? [],
          );
        }
      for (const m of root.listMaterials()) m.setBaseColorFactor([1, 1, 1, 1]).setName('Pigeon');
    },
  },
  {
    name: 'rabbit',
    fbx: 'rabbit.fbx',
    edit: async (doc, src) => {
      const root = doc.getRoot();
      // The alpha-blended fur shell goes (no transparency in the game's style passes).
      for (const n of root.listNodes()) if (n.getName() === 'Fur') n.dispose();
      const png = PNG.sync.read(await readFile(join(src, 'texture/rabbit-skinn.png')));
      for (const mesh of root.listMeshes())
        for (const prim of mesh.listPrimitives()) bakeVertexColours(doc, prim, png);
      for (const m of root.listMaterials()) {
        m.setBaseColorTexture(null).setNormalTexture(null).setAlphaMode('OPAQUE');
        m.setBaseColorFactor([1, 1, 1, 1]).setName('Rabbit');
      }
      for (const t of root.listTextures()) t.dispose();
    },
  },
];

/**
 * Feral pigeon plumage (palette colours, sRGB) by bone: blue-grey body, light wing coverts with
 * dark flight feathers, a dark tail band, purple-sheened neck, red legs.
 */
const PIGEON_BONES: Record<string, number> = {
  'thorax-bone': 0x7a7d8a,
  'neck-bone': 0x4a3a5a,
  'face-bone': 0x5e6170,
  'right-wing-1': 0xa2a5ae,
  'left-wing-1': 0xa2a5ae,
  'right-wing-2': 0x48495c,
  'left-wing-2': 0x48495c,
  'tail-bone-1': 0x7a7d8a,
  'tail-bone-2': 0x353548,
  'left-upper-leg-bone': 0x7a7d8a,
  'right-upper-leg-bone': 0x7a7d8a,
  'left-lower-leg-bone': 0xc8453c,
  'right-lower-leg-bone': 0xc8453c,
};

/** Per-vertex colour = skin-weighted blend of the bone colours (linear). */
function paintByBones(doc: Document, prim: Primitive, joints: string[]): void {
  const j = prim.getAttribute('JOINTS_0');
  const w = prim.getAttribute('WEIGHTS_0');
  if (!j || !w) return;
  const lin = (hex: number) => [16, 8, 0].map((s) => ((hex >> s) & 255) / 255).map((c) => c ** 2.2);
  const n = j.getCount();
  const out = new Float32Array(n * 4);
  const ji = [0, 0, 0, 0];
  const wi = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    j.getElement(i, ji);
    w.getElement(i, wi);
    const c = [0, 0, 0];
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const hex = PIGEON_BONES[joints[ji[k]!] ?? ''] ?? 0x7a7d8a;
      const l = lin(hex);
      for (let e = 0; e < 3; e++) c[e]! += l[e]! * wi[k]!;
      sum += wi[k]!;
    }
    sum = Math.max(sum, 1e-6);
    out.set([c[0]! / sum, c[1]! / sum, c[2]! / sum, 1], i * 4);
  }
  prim.setAttribute(
    'COLOR_0',
    doc.createAccessor().setType('VEC4').setArray(out).setBuffer(j.getBuffer()),
  );
}

/**
 * Photo texture → flat per-vertex colour (the game's low-poly look has no textures): the
 * average of a 9×9 texel block around each vertex UV, in linear space.
 */
function bakeVertexColours(doc: Document, prim: Primitive, png: PNG): void {
  const uv = prim.getAttribute('TEXCOORD_0');
  if (!uv) return;
  const n = uv.getCount();
  const out = new Float32Array(n * 4);
  const lin = (c: number) => (c / 255) ** 2.2;
  const t = [0, 0];
  for (let i = 0; i < n; i++) {
    uv.getElement(i, t);
    const cx = Math.round((((t[0]! % 1) + 1) % 1) * (png.width - 1));
    const cy = Math.round((((t[1]! % 1) + 1) % 1) * (png.height - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    let k = 0;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = Math.min(png.width - 1, Math.max(0, cx + dx));
        const y = Math.min(png.height - 1, Math.max(0, cy + dy));
        const o = (y * png.width + x) * 4;
        if ((png.data[o + 3] ?? 0) < 128) continue;
        r += lin(png.data[o] ?? 0);
        g += lin(png.data[o + 1] ?? 0);
        b += lin(png.data[o + 2] ?? 0);
        k++;
      }
    k = Math.max(1, k);
    out.set([r / k, g / k, b / k, 1], i * 4);
  }
  prim.setAttribute(
    'COLOR_0',
    doc.createAccessor().setType('VEC4').setArray(out).setBuffer(uv.getBuffer()),
  );
  prim.setAttribute('TEXCOORD_0', null);
  prim.setAttribute('TANGENT', null);
}

export async function buildAnimalSources(io: NodeIO, src: string, outDir: string): Promise<void> {
  const scripts = outDir;
  const bin = process.env.FBX2GLTF;
  if (!bin) throw new Error('FBX2GLTF: ścieżka do binarki FBX2glTF (npm fbx2gltf)');
  const blender = process.env.BLENDER;
  if (!blender) throw new Error('BLENDER: ścieżka do Blendera 4.2 (blender.org)');
  await ready();
  const tmp = await mkdtemp(join(tmpdir(), 'dz-animals-'));
  try {
    for (const s of SOURCES) {
      const base = join(tmp, s.name);
      if (s.fbx)
        execFileSync(bin, ['--binary', '--input', join(src, s.fbx), '--output', base], {
          stdio: 'ignore',
        });
      else if (s.blend)
        execFileSync(
          blender,
          [
            '-b',
            join(src, s.blend.file),
            '--python',
            join(scripts, s.blend.script),
            '--',
            `${base}.glb`,
          ],
          { stdio: 'ignore' },
        );
      const doc = await io.read(`${base}.glb`);
      for (const m of doc.getRoot().listMaterials()) {
        const hex = s.colours?.[m.getName()];
        if (hex === undefined) continue;
        const lin = (v: number) => (v / 255) ** 2.2;
        m.setBaseColorFactor([lin((hex >> 16) & 255), lin((hex >> 8) & 255), lin(hex & 255), 1]);
      }
      await s.edit?.(doc, src);
      await doc.transform(
        resample(),
        prune(),
        meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      );
      const out = join(outDir, `${s.name}.glb`);
      await writeFile(out, await io.writeBinary(doc));
      console.log(out);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
