import { Box3, Vector3, WebGLRenderer, type Object3D } from 'three';
import { GpuBudget } from '../assets/budget.js';
import { AssetLoader } from '../assets/loader.js';
import { createIsometricCamera, resizeIsometricCamera } from '../camera/isometric.js';
import { CameraRig } from '../camera/rig.js';
import { createScene } from '../scene.js';
import { createStatsOverlay } from './stats-overlay.js';

/**
 * Dev-only `?assettest=1` (optionally `&budgetmb=N` to see the over-budget warning): loads every
 * manifest asset in a row per LOD level to verify the pipeline + loader. Not part of the game.
 */
const container = document.getElementById('app');
if (!container) throw new Error('#app not found');
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = createScene();
const camera = createIsometricCamera({ aspect: 1, viewHeight: 12 });
const rig = new CameraRig(camera);
const budgetMb = Number(new URLSearchParams(window.location.search).get('budgetmb'));
const budget =
  budgetMb > 0
    ? new GpuBudget(budgetMb * 1024 * 1024, (t, l) => console.warn(`GPU budget: ${t} > ${l} B`))
    : new GpuBudget(undefined, (t, l) => console.warn(`GPU budget: ${t} > ${l} B`));
const loader = new AssetLoader({ renderer, budget, lodDistanceBias: 100 });
const manifest = await loader.loadManifest();

const SPACING = 2.2;
const place = (o: Object3D, col: number, row: number) => {
  const size = new Box3().setFromObject(o).getSize(new Vector3());
  const s = Math.min(1, 1.8 / Math.max(size.x, size.z, 0.01));
  o.scale.setScalar(s);
  o.position.set((col - (manifest.assets.length - 1) / 2) * SPACING, 0, row * SPACING - 2);
  scene.add(o);
};
const maxLods = Math.max(...manifest.assets.map((a) => a.lods.length));
await Promise.all(
  manifest.assets.flatMap((a, col) =>
    Array.from({ length: maxLods }, async (_, row) => {
      if (row < a.lods.length) place(await loader.loadLevel(a.id, row), col, row);
    }),
  ),
);
// One real THREE.LOD per asset in the front row (switches with zoom).
await Promise.all(manifest.assets.map(async (a, col) => place(await loader.load(a.id), col, -1)));

const tris = manifest.assets.reduce((s, a) => s + a.lods[0]!.triangles, 0);
const overlay = createStatsOverlay(
  document.body,
  () =>
    `assettest: ${manifest.assets.length} assets · rows = LOD auto, 0, 1, 2 · ${tris} tris LOD0\n` +
    `materials ${loader.materials.size} · ${budget.line()}`,
);

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeIsometricCamera(camera, window.innerWidth / Math.max(window.innerHeight, 1), 12);
}
window.addEventListener('resize', resize);
resize();
renderer.setAnimationLoop((time) => {
  rig.update(time);
  renderer.render(scene, camera);
  overlay(renderer);
});
