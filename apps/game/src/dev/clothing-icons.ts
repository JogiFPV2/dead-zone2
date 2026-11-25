import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  SkinnedMesh,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ModelKit, ZOMBIE_MODELS } from '../models/model-kit.js';
import { rebuildCharacter, type BodySpec } from '../models/painted-body/body.js';
import { GARMENTS, dressedBody, type WornClothes } from '../models/painted-body/wardrobe.js';
import { PLAYER_HEIGHT } from '../player/player-view.js';

/**
 * Dev icon baker for the clothes (`/clothing-icons.html`): each garment on the painted body in
 * its bind pose, everything else drawn in a key colour and cut away, framed to 128 px with a
 * transparent background. `window.__icons` = { item id: PNG data URL } (saved by a script into
 * `public/icons`).
 */
const KEY = '#ff00ff';
const SIZE = 128;
const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE);
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);
const scene = new Scene();
scene.add(new HemisphereLight('#fff6e6', '#5a5a66', 1.5));
const sun = new DirectionalLight('#fff1d8', 2.0);
sun.position.set(2, 5, 6);
scene.add(sun);

const SLOT: Record<string, keyof WornClothes> = {
  inner: 'torso_inner',
  outer: 'torso_outer',
  legs: 'legs',
  feet: 'feet',
  hands: 'hands',
  head: 'head',
  face: 'face',
};

/** Spec showing only `id`'s garment; the rest in the key colour. */
function onlyGarment(id: string): BodySpec {
  const g = GARMENTS[id]!;
  const s = dressedBody(
    { skin: KEY, hair: KEY, hairStyle: 'bald' },
    { [SLOT[g.kind]!]: { def: id } },
  );
  if (g.kind !== 'inner' && g.kind !== 'outer') {
    s.top = s.topTrim = KEY;
    s.topCut = 'tank';
    delete s.hood;
  }
  if (s.jacket) s.jacket.under = KEY;
  if (g.kind !== 'legs') s.trousers = s.belt = KEY;
  if (g.kind !== 'feet') s.shoes = s.sole = KEY;
  return s;
}

const kit = await ModelKit.create(renderer);
if (!kit) throw new Error('no models');
const out: Record<string, string> = {};
for (const id of Object.keys(GARMENTS)) {
  const { object } = await kit.character(ZOMBIE_MODELS[0]!, PLAYER_HEIGHT);
  const mesh = rebuildCharacter(object, onlyGarment(id));
  // Cut the key colour: drop triangles whose vertices are magenta.
  const g = mesh.geometry;
  const col = g.getAttribute('color');
  const idx = g.getIndex()!;
  const keep: number[] = [];
  const isKey = (i: number) => col.getX(i) > 0.9 && col.getY(i) < 0.1 && col.getZ(i) > 0.9;
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t),
      b = idx.getX(t + 1),
      c = idx.getX(t + 2);
    if (!isKey(a) && !isKey(b) && !isKey(c)) keep.push(a, b, c);
  }
  g.setIndex(keep);
  scene.add(object);
  object.updateMatrixWorld(true);
  // Frame the garment (bind pose): bounds of the kept vertices.
  const pos = g.getAttribute('position');
  const box = new Box3();
  const v = new Vector3();
  for (const i of keep)
    box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  const c = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const half = Math.max(size.x, size.y, size.z) * 0.58;
  const cam = new OrthographicCamera(-half, half, half, -half, 0.01, 50);
  cam.position.copy(c).add(new Vector3(0.35, 0.45, 1).normalize().multiplyScalar(10));
  cam.lookAt(c);
  renderer.render(scene, cam);
  out[id] = renderer.domElement.toDataURL('image/png');
  scene.remove(object);
  (mesh as SkinnedMesh).geometry.dispose();
}
(window as unknown as { __icons: Record<string, string> }).__icons = out;
