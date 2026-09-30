import { WebGLRenderer } from 'three';
import { createIsometricCamera, resizeIsometricCamera } from './camera/isometric.js';
import { CameraRig } from './camera/rig.js';
import { followStep } from './camera/follow.js';
import { bindCameraInput } from './input/camera-input.js';
import { PlayerInput } from './input/player-input.js';
import { PlayerView } from './player/player-view.js';
import { createScene } from './scene.js';
import { simToWorld } from './sim/coords.js';
import { SnapshotBuffer } from './sim/interpolate.js';
import { MOCK_TICK_MS } from './sim/mock-step.js';
import { MockSimClient } from './sim/mock-sim-client.js';
import { CommandStamper } from './sim/sim-client.js';
import { readEntity } from './sim/snapshot.js';
import { TEST_MAP_RANGE, createTestMap, rangeBounds } from './world/test-map.js';
import { Terrain } from './world/terrain.js';
import { tileOf } from './world/building-lookup.js';
import { cameraSide } from './world/cutaway.js';
import { Structures } from './world/structures.js';
import { TEST_BUILDING_INSIDE } from './world/test-building.js';
import { CrowdBuffer } from './crowd/crowd-buffer.js';
import { CrowdView } from './crowd/crowd-view.js';
import { parseCrowdParam } from './crowd/mock-crowd.js';
import { tickAlpha } from './sim/interpolate.js';
import type { FrameSample } from './dev/frame-bench.js';

const VIEW_HEIGHT = 24;
const PLAYER_ID = 1;
const FOLLOW_HALF_LIFE_MS = 80;

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = createScene();
const map = createTestMap();
const terrain = new Terrain(map);
terrain.loadRange(TEST_MAP_RANGE);
scene.add(terrain.root);
const structures = new Structures(map);
structures.loadRange(TEST_MAP_RANGE);
scene.add(structures.root);
const camera = createIsometricCamera({ aspect: 1, viewHeight: VIEW_HEIGHT });
const rig = new CameraRig(camera);
bindCameraInput(rig, renderer.domElement);

// TEMPORARY: MockSimClient until the real Worker sim (createSimWorkerClient) lands.
// TEMPORARY debug spawn: `?spawn=inside` starts in the test building (screenshots, cutaway checks).
const spawnInside = new URLSearchParams(window.location.search).get('spawn') === 'inside';
const spawn = spawnInside ? TEST_BUILDING_INSIDE : { x: 6.5, y: 6.5 };
// TEMPORARY load test: `?crowd=N` adds N wandering placeholder entities to the mock sim.
const crowdCount = parseCrowdParam(window.location.search);
const sim = new MockSimClient(rangeBounds(TEST_MAP_RANGE), spawn, PLAYER_ID, {
  count: crowdCount,
  seed: 1,
});
const stamper = new CommandStamper(PLAYER_ID);
const playerInput = new PlayerInput(renderer.domElement, sim, stamper);
const snapshots = new SnapshotBuffer();
const crowd = new CrowdBuffer();
let crowdArrivedMs = 0;
sim.onSnapshot(({ tick, buf }) => {
  stamper.tick = tick;
  const player = readEntity(buf, 0);
  if (player) snapshots.push(player, performance.now());
  crowd.push(buf, 1);
  crowdArrivedMs = performance.now();
});
const crowdView = new CrowdView(crowd, (next, prev) => {
  scene.remove(prev);
  scene.add(next);
});
scene.add(crowdView.mesh);
const player = new PlayerView();
scene.add(player.root);

function resize(): void {
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  renderer.setSize(width, height);
  resizeIsometricCamera(camera, width / Math.max(height, 1), VIEW_HEIGHT);
}

new ResizeObserver(resize).observe(container);
resize();

let afterRender: ((r: WebGLRenderer) => void) | undefined;
let recordFrame: ((s: FrameSample, r: WebGLRenderer) => void) | undefined;
if (import.meta.env.DEV) {
  void Promise.all([import('./dev/stats-overlay.js'), import('./dev/crowd-bench.js')]).then(
    ([{ createStatsOverlay }, { createCrowdBench }]) => {
      const bench = createCrowdBench(() => crowd.count);
      recordFrame = bench.record;
      afterRender = createStatsOverlay(document.body, bench.line);
    },
  );
}
const frameSample: FrameSample = { updateMs: 0, renderMs: 0 };

let lastFrameMs: number | undefined;
let cameraSnapped = false;
renderer.setAnimationLoop((time) => {
  const dt = lastFrameMs === undefined ? 0 : time - lastFrameMs;
  lastFrameMs = time;
  playerInput.update(time, rig.targetYaw, camera);
  const state = snapshots.sample(performance.now(), MOCK_TICK_MS);
  if (state) {
    player.apply(state);
    const goal = simToWorld(state.x, state.y, state.z);
    if (!cameraSnapped) rig.target.set(goal.x, goal.y, goal.z);
    else followStep(rig.target, goal, dt, FOLLOW_HALF_LIFE_MS);
    cameraSnapped = true;
    const { tx, ty } = tileOf(state.x, state.y);
    const building = structures.lookup.at(tx, ty, state.z);
    structures.setCutaway({ building, tx, ty, side: cameraSide(rig.targetYaw) });
  }
  rig.update(time);
  const t0 = performance.now();
  crowdView.update(tickAlpha(t0, crowdArrivedMs, MOCK_TICK_MS));
  const t1 = performance.now();
  renderer.render(scene, camera);
  frameSample.updateMs = t1 - t0;
  frameSample.renderMs = performance.now() - t1;
  recordFrame?.(frameSample, renderer);
  afterRender?.(renderer);
});
