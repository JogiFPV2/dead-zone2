import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { fitted } from '../models/model-kit.js';
import type { ChunkData } from './chunk.js';
import { buildInstances, mergeParts, modelParts, setSlotsVisible } from './furniture-instances.js';
import { MapObjects } from './map-objects.js';

const geoA = new BoxGeometry(1, 2, 1);
const geoB = new BoxGeometry(0.5, 0.5, 0.5);
const mat = new MeshStandardMaterial();

/** Two-part model (body + knob offset), like a Kenney furniture glb. */
function model(): Group {
  const g = new Group();
  const body = new Mesh(geoA, mat);
  const knob = new Mesh(geoB, mat);
  knob.position.set(0.3, 1, 0.5);
  body.add(knob);
  g.add(body);
  return g;
}

const worldPos = (o: Mesh | undefined): Vector3 => {
  o!.updateMatrixWorld(true);
  return new Vector3().setFromMatrixPosition(o!.matrixWorld);
};

describe('furniture instancing', () => {
  it('modelParts keeps every visible mesh with its transform', () => {
    const m = fitted(model(), 1.8);
    const parts = modelParts(m);
    expect(parts.map((p) => p.geometry)).toEqual([geoA, geoB]);
  });

  it('mergeParts: parts of one material become one geometry in the model frame', () => {
    const parts = modelParts(fitted(model(), 1.8));
    const merged = mergeParts(parts);
    expect(merged).toHaveLength(1);
    const n = geoA.getAttribute('position').count + geoB.getAttribute('position').count;
    expect(merged[0]!.geometry.getAttribute('position').count).toBe(n);
    // Knob vertices sit where the knob part's matrix put them.
    merged[0]!.geometry.computeBoundingBox();
    const bb = merged[0]!.geometry.boundingBox!;
    const knob = new Vector3().setFromMatrixPosition(parts[1]!.local);
    expect(bb.max.z).toBeGreaterThanOrEqual(knob.z);
    const other = new MeshStandardMaterial();
    expect(mergeParts([parts[0]!, { ...parts[1]!, material: other }])).toHaveLength(2);
  });

  it('one InstancedMesh per part; instance matrices match a placed clone', () => {
    const tpl = fitted(model(), 1.8);
    const parts = modelParts(tpl);
    const root = new Group();
    const placements = [
      { model: 'm', x: 3, y: 0, z: -2, rotY: Math.PI / 2 },
      { model: 'm', x: -1, y: 3, z: 4, rotY: 0 },
      { model: 'none', x: 0, y: 0, z: 0, rotY: 0 },
    ];
    const { meshes, slots } = buildInstances(
      placements,
      (k) => (k === 'm' ? parts : undefined),
      root,
    );
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m instanceof InstancedMesh && m.count === 2)).toBe(true);
    expect(slots[2]).toBeUndefined();
    // Same world transform as the old clone-per-object path.
    const clone = fitted(model(), 1.8);
    clone.position.set(3, 0, -2);
    clone.rotation.y = Math.PI / 2;
    clone.updateMatrixWorld(true);
    let knob: Mesh | undefined;
    clone.traverse((o) => {
      if (o instanceof Mesh && o.geometry === geoB) knob = o;
    });
    const im = meshes.find((m) => m.geometry === geoB)!;
    const at = new Matrix4();
    im.getMatrixAt(0, at);
    const p = new Vector3().setFromMatrixPosition(at);
    const e = worldPos(knob);
    expect(p.x).toBeCloseTo(e.x, 5);
    expect(p.y).toBeCloseTo(e.y, 5);
    expect(p.z).toBeCloseTo(e.z, 5);
    // Hide / show one placement.
    setSlotsVisible(slots[0]!, false);
    im.getMatrixAt(0, at);
    expect(at.determinant()).toBe(0);
    setSlotsVisible(slots[0]!, true);
    im.getMatrixAt(0, at);
    expect(new Vector3().setFromMatrixPosition(at).x).toBeCloseTo(e.x, 5);
  });

  it('MapObjects: models are instanced over loaded chunks, x-ray swaps in a clone, unload frees them', () => {
    const chunk = {
      coord: { cx: 0, cy: 0, z: 0 },
      objects: [
        { contentId: 'base:fridge', x: 1, y: 1, rot: 0 },
        { contentId: 'base:fridge', x: 3, y: 1, rot: 1 },
        { contentId: 'base:crate', x: 5, y: 2, rot: 0 },
      ],
    } as unknown as ChunkData;
    const objs = new MapObjects();
    objs.loadChunk(chunk);
    objs.applyModels((id) => (id === 'base:fridge' ? fitted(model(), 1.8) : undefined));
    // Fridge (two parts, one material: merged) + the crate's grey box (no model: instanced too).
    expect(objs.instancedMeshCount).toBe(2);
    const meshes = () => objs.root.children.filter((c) => c instanceof InstancedMesh);
    expect(meshes()).toHaveLength(2);
    const visibleBoxes = objs.root.children.filter(
      (c) => c instanceof Mesh && !(c instanceof InstancedMesh) && c.visible && c.geometry !== geoA,
    );
    expect(visibleBoxes.length).toBe(0);
    // X-ray on the crate: its own see-through box stands in.
    const n = objs.root.children.length;
    objs.setXray(5, 2, 0, true);
    expect(objs.root.children.length).toBe(n + 1);
    objs.setXray(5, 2, 0, false);
    expect(objs.root.children.length).toBe(n);
    const before = objs.root.children.length;
    objs.setXray(1, 1, 0, true);
    expect(objs.root.children.length).toBe(before + 1);
    objs.setXray(1, 1, 0, false);
    expect(objs.root.children.length).toBe(before);
    // A second chunk with the same model adds instances, not draw calls.
    objs.loadChunk({ ...chunk, coord: { cx: 1, cy: 0, z: 0 } });
    expect(objs.instancedMeshCount).toBe(2);
    expect(meshes()[0]!.count).toBe(4);
    objs.unloadChunk(1, 0, 0);
    objs.unloadChunk(0, 0, 0);
    expect(objs.instancedMeshCount).toBe(0);
    expect(objs.root.children).toHaveLength(0);
  });
});
