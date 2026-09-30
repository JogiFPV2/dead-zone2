import { WebGLRenderer } from 'three';
import {
  CAMERA_DISTANCE,
  createIsometricCamera,
  resizeIsometricCamera,
} from './camera/isometric.js';
import { CameraRig } from './camera/rig.js';
import { followStep } from './camera/follow.js';
import { bindCameraInput } from './input/camera-input.js';
import { InputMap } from './input/input-map.js';
import { PlayerInput } from './input/player-input.js';
import { createSettingsStore } from './settings/store.js';
import { PlayerView } from './player/player-view.js';
import { createScene } from './scene.js';
import { createWorldLighting } from './lighting/index.js';
import { createTestLamps } from './world/test-lamps.js';
import { simToWorld } from './sim/coords.js';
import { SnapshotBuffer } from './sim/interpolate.js';
import { TICK_MS } from '@deadzone/sim';
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
import { parseBootOptions } from './boot-options.js';
import { startSimWorker } from './sim/start-sim.js';
import { GameStateStore, connectSimState } from './state/game-state.js';
import { describeEvent, devStateLine } from './state/format.js';
import type { SimClient } from './sim/sim-client.js';
import type { LoadedMap } from './world/content-map.js';
import { startSpawn } from './world/zones.js';
import { tickAlpha } from './sim/interpolate.js';
import type { FrameSample } from './dev/frame-bench.js';

const VIEW_HEIGHT = 24;
/** Singleplayer: the local player is sim player 0. */
const PLAYER_ID = 0;
const SIM_SEED = 1;
const FOLLOW_HALF_LIFE_MS = 80;

/** The game itself (the default page); imported by main.ts. */
const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const boot = parseBootOptions(window.location.search);
// Base pack for the sim (survival content), fetched in parallel with the map/scene setup.
const simContent =
  boot.sim === 'worker'
    ? import('./content/sim-content.js')
        .then((m) => m.loadSimContent())
        .catch((e: unknown) => {
          console.error('Sim content failed to load; survival disabled', e);
          return undefined;
        })
    : undefined;
const world: LoadedMap =
  boot.map !== 'test'
    ? await import('./world/load-content-map.js').then((m) => m.loadBaseMap(boot.map))
    : { source: createTestMap(), range: TEST_MAP_RANGE, zones: [] };

const scene = createScene();
const terrain = new Terrain(world.source);
terrain.loadRange(world.range);
scene.add(terrain.root);
const structures = new Structures(world.source);
structures.loadRange(world.range);
scene.add(structures.root);
if (import.meta.env.DEV && boot.zones) {
  void import('./dev/zones-overlay.js').then(({ createZonesOverlay }) =>
    scene.add(createZonesOverlay(world.zones)),
  );
}
const camera = createIsometricCamera({ aspect: 1, viewHeight: VIEW_HEIGHT });
const rig = new CameraRig(camera);
const settings = createSettingsStore();
const input = new InputMap(settings.get().input.bindings, {
  window,
  element: renderer.domElement,
  document,
});
settings.subscribe((next) => input.setBindings(next.input.bindings));
bindCameraInput(rig, input);

// Real sim in a Web Worker. TEMPORARY: the mock stays for `?crowd=N` (no NPCs in the sim yet;
// they come with zombies); it has no collisions and no survival.
const gameState = new GameStateStore();
let sim: SimClient;
if (boot.sim === 'worker') {
  const worker = startSimWorker(world.source, world.range, SIM_SEED, {
    spawn: boot.spawnInside ? { ...TEST_BUILDING_INSIDE, z: 0 } : startSpawn(world.zones),
    content: await simContent,
    dev: import.meta.env.DEV,
  });
  connectSimState(gameState, worker);
  sim = worker;
} else {
  sim = new MockSimClient(
    rangeBounds(world.range),
    boot.spawnInside ? TEST_BUILDING_INSIDE : { x: 6.5, y: 6.5 },
    PLAYER_ID,
    { count: boot.crowd, seed: SIM_SEED },
  );
}
gameState.subscribe((_next, _prev, action) => {
  if (action.type === 'error') console.error(`Sim error: ${action.message}`);
  else if (import.meta.env.DEV && action.type === 'events') {
    for (const e of action.events) console.debug(`[sim t${e.tick}] ${describeEvent(e)}`);
  }
});
const stamper = new CommandStamper(PLAYER_ID);
const playerInput = new PlayerInput(renderer.domElement, input, sim, stamper);
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
// Night is the default (and for now the only approved) look. Lamps: test map placeholder list.
const lighting = createWorldLighting(
  scene,
  renderer,
  boot.map === 'test' ? createTestLamps() : [],
  CAMERA_DISTANCE,
);

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
      const pos = () => {
        const p = snapshots.sample(performance.now(), TICK_MS);
        return p ? `player ${p.x.toFixed(2)}, ${p.y.toFixed(2)} · sim ${boot.sim}` : '';
      };
      afterRender = createStatsOverlay(
        document.body,
        () => `${bench.line()}\n${pos()}\n${devStateLine(gameState.get())}`,
      );
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
  const state = snapshots.sample(performance.now(), TICK_MS);
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
  lighting.update(camera, rig.target.x, rig.target.z);
  const t0 = performance.now();
  crowdView.update(tickAlpha(t0, crowdArrivedMs, TICK_MS));
  const t1 = performance.now();
  renderer.render(scene, camera);
  frameSample.updateMs = t1 - t0;
  frameSample.renderMs = performance.now() - t1;
  recordFrame?.(frameSample, renderer);
  afterRender?.(renderer);
});
