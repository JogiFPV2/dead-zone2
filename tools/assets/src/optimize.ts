import type { Document, Transform } from '@gltf-transform/core';
import { dedup, meshopt, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

export interface OptimizeOptions {
  /** If set, all materials are replaced by one texture-less material with this name. */
  paletteMaterial?: string | undefined;
  /** Triangle ratio for LOD levels (< 1 simplifies). */
  ratio?: number;
  /** Max simplification error (fraction of mesh extent); low-poly models need a loose bound. */
  error?: number;
  /** Animated models: clips to keep (see `Pack.keepAnimations`). */
  keepAnimations?: readonly string[] | undefined;
}

/** Bare clip name (`AnimalArmature|Walk` → `Walk`; Blender exports repeat the armature prefix). */
export const clipName = (name: string): string => name.slice(name.lastIndexOf('|') + 1);

/**
 * Keeps only the listed clips, the first one of each name (packs often hold every clip twice:
 * `Walk` and `Armature|Walk`). Samplers / accessors of the dropped clips go with `prune`.
 */
export function keepAnimations(names: readonly string[]): Transform {
  return (doc: Document) => {
    const seen = new Set<string>();
    for (const a of doc.getRoot().listAnimations()) {
      const n = clipName(a.getName());
      if (!names.includes(n) || seen.has(n)) {
        for (const c of a.listChannels()) c.dispose();
        for (const s of a.listSamplers()) s.dispose();
        a.dispose();
      } else seen.add(n);
    }
  };
}

/**
 * Palette packing: every model of a low-poly pack samples one shared colour texture, so the
 * texture is stripped and all primitives get one named material; the runtime swaps it for a
 * single shared THREE material (one texture upload per pack instead of per model).
 */
export function palettize(name: string): Transform {
  return (doc: Document) => {
    const root = doc.getRoot();
    const shared = doc
      .createMaterial(name)
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
      .setDoubleSided(true);
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        prim.setMaterial(shared);
        // Tangents are not needed without normal maps (saves 16 B per vertex).
        prim.setAttribute('TANGENT', null);
      }
    }
    for (const m of root.listMaterials()) if (m !== shared) m.dispose();
    for (const t of root.listTextures()) t.dispose();
  };
}

/** Texture-less output does not need KHR_texture_transform (left over from the source). */
const dropUnusedExtensions: Transform = (doc) => {
  const hasTextures = doc.getRoot().listTextures().length > 0;
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_texture_transform' && !hasTextures) ext.dispose();
  }
};

export async function ready(): Promise<void> {
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
}

/** dedup → weld → (simplify) → quantize + meshopt (EXT_meshopt_compression) → prune. */
export async function optimize(doc: Document, opts: OptimizeOptions = {}): Promise<Document> {
  await ready();
  const steps: Transform[] = [];
  if (opts.paletteMaterial) steps.push(palettize(opts.paletteMaterial));
  if (opts.keepAnimations) steps.push(keepAnimations(opts.keepAnimations));
  steps.push(dedup(), weld());
  if (opts.ratio !== undefined && opts.ratio < 1) {
    steps.push(
      simplify({ simplifier: MeshoptSimplifier, ratio: opts.ratio, error: opts.error ?? 0.1 }),
    );
  }
  // keepAttributes: palette UVs must survive although the GLB material has no texture.
  steps.push(
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    prune({ keepAttributes: true }),
    dropUnusedExtensions,
  );
  await doc.transform(...steps);
  return doc;
}

export function countTriangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += (idx ? idx.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0)) / 3;
    }
  }
  return Math.round(n);
}
