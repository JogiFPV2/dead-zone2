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

const VIEW_HEIGHT = 24;
const PLAYER_ID = 1;
const FOLLOW_HALF_LIFE_MS = 80;

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = createScene();
const terrain = new Terrain(createTestMap());
terrain.loadRange(TEST_MAP_RANGE);
scene.add(terrain.root);
const camera = createIsometricCamera({ aspect: 1, viewHeight: VIEW_HEIGHT });
const rig = new CameraRig(camera);
bindCameraInput(rig, renderer.domElement);

// TEMPORARY: MockSimClient until the real Worker sim (createSimWorkerClient) lands.
const sim = new MockSimClient(rangeBounds(TEST_MAP_RANGE), { x: 6.5, y: 6.5 }, PLAYER_ID);
const stamper = new CommandStamper(PLAYER_ID);
const playerInput = new PlayerInput(renderer.domElement, sim, stamper);
const snapshots = new SnapshotBuffer();
sim.onSnapshot(({ tick, buf }) => {
  stamper.tick = tick;
  const player = readEntity(buf, 0);
  if (player) snapshots.push(player, performance.now());
});
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
if (import.meta.env.DEV) {
  void import('./dev/stats-overlay.js').then(({ createStatsOverlay }) => {
    afterRender = createStatsOverlay(document.body);
  });
}

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
  }
  rig.update(time);
  renderer.render(scene, camera);
  afterRender?.(renderer);
});
