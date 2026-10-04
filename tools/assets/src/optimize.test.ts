import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { clipName, countTriangles, keepAnimations, optimize } from './optimize.js';

/** n×n grid of quads (bumpy, so simplification has something to trade) with two materials. */
function gridDoc(n: number): Document {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos: number[] = [];
  const idx: number[] = [];
  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) pos.push(x, 0.001 * ((x * 7 + z * 13) % 5), z);
  }
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * (n + 1) + x;
      idx.push(i, i + n + 1, i + 1, i + 1, i + n + 1, i + n + 2);
    }
  }
  const vcount = (n + 1) * (n + 1);
  const acc = (type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR', arr: Float32Array | Uint32Array) =>
    doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const tex = doc
    .createTexture('palette')
    .setImage(new Uint8Array([1, 2, 3]))
    .setMimeType('image/png');
  const mesh = doc.createMesh();
  for (const name of ['a', 'b']) {
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute('POSITION', acc('VEC3', new Float32Array(pos)))
        .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(vcount * 2).fill(0.5)))
        .setAttribute('TANGENT', acc('VEC4', new Float32Array(vcount * 4).fill(1)))
        .setIndices(acc('SCALAR', new Uint32Array(idx)))
        .setMaterial(doc.createMaterial(name).setBaseColorTexture(tex)),
    );
  }
  doc.createScene().addChild(doc.createNode().setMesh(mesh));
  return doc;
}

describe('optimize', () => {
  it('packs every primitive onto one texture-less palette material and drops tangents', async () => {
    const doc = await optimize(gridDoc(4), { paletteMaterial: 'p/palette' });
    const root = doc.getRoot();
    expect(root.listMaterials().map((m) => m.getName())).toEqual(['p/palette']);
    expect(root.listTextures()).toHaveLength(0);
    for (const prim of root.listMeshes()[0]!.listPrimitives()) {
      expect(prim.getAttribute('TANGENT')).toBeNull();
      // Palette UVs survive although the material has no texture.
      expect(prim.getAttribute('TEXCOORD_0')).not.toBeNull();
    }
    const exts = root.listExtensionsUsed().map((e) => e.extensionName);
    expect(exts).toContain('EXT_meshopt_compression');
  });

  it('simplifies for LOD levels and round-trips through GLB', async () => {
    const full = countTriangles(await optimize(gridDoc(16)));
    const lod = await optimize(gridDoc(16), { ratio: 0.25 });
    expect(countTriangles(lod)).toBeLessThan(full * 0.5);
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });
    const back = await io.readBinary(await io.writeBinary(lod));
    expect(countTriangles(back)).toBe(countTriangles(lod));
  });

  it('keeps only the listed clips, the first one of each name', async () => {
    const doc = gridDoc(2);
    const node = doc.getRoot().listNodes()[0]!;
    const buf = doc.getRoot().listBuffers()[0]!;
    for (const name of ['Walk', 'Armature|Walk', 'Armature|Idle', 'Attack']) {
      const sampler = doc
        .createAnimationSampler()
        .setInput(
          doc
            .createAccessor()
            .setType('SCALAR')
            .setArray(new Float32Array([0, 1]))
            .setBuffer(buf),
        )
        .setOutput(
          doc.createAccessor().setType('VEC3').setArray(new Float32Array(6)).setBuffer(buf),
        );
      doc
        .createAnimation(name)
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(node)
            .setTargetPath('translation')
            .setSampler(sampler),
        );
    }
    await doc.transform(keepAnimations(['Walk', 'Idle']));
    expect(
      doc
        .getRoot()
        .listAnimations()
        .map((a) => a.getName()),
    ).toEqual(['Walk', 'Armature|Idle']);
    expect(clipName('AnimalArmature|AnimalArmature|Death')).toBe('Death');
  });
});
