import { Group, WebGLRenderer } from 'three';
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
import {
  DAY_CYCLE,
  DayCycle,
  clockMinute,
  createWorldLighting,
  formatMinute,
  overrideMinute,
} from './lighting/index.js';
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
import { createHud } from './hud/hud.js';
import { PICK_PLANE_Y, ZombieHpLayer } from './hud/zombie-hp.js';
import { clientToNdc, ndcToFloor } from './input/aim.js';
import { interactIntent } from './hud/hud-model.js';
import { minimapGeometry } from './hud/minimap-data.js';
import {
  EMPTY_HUD_CONTENT,
  buildHudContentIndex,
  type HudContentIndex,
} from './hud/content-index.js';
import { createInventoryWindow } from './hud/inventory-window.js';
import { createLootWindow } from './hud/loot-window.js';
import { loadItemIcons } from './hud/item-icons.js';
import { actionKey } from './hud/key-label.js';
import { showDeathScreen } from './death/death-screen.js';
import { GroundPiles } from './world/ground-piles.js';
import { MapObjects } from './world/map-objects.js';
import { CONTAINER_MODELS, ModelKit, PILE_MODEL, PLAYER_MODEL } from './models/model-kit.js';
import { brighten, loadZombieTemplates } from './models/zombie-views.js';
import { InstancedZombies } from './models/instanced-zombies.js';
import { PLAYER_HEIGHT } from './player/player-view.js';

const VIEW_HEIGHT = 24;
const QUICKSLOTS = ['quickslot1', 'quickslot2', 'quickslot3', 'quickslot4', 'quickslot5'] as const;
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
  const spawn = boot.spawnInside
    ? { ...TEST_BUILDING_INSIDE, z: 0 }
    : import.meta.env.DEV && boot.spawnAt
      ? { ...boot.spawnAt, z: 0 }
      : startSpawn(world.zones);
  const worker = startSimWorker(world.source, world.range, SIM_SEED, {
    spawn,
    // Content maps get zombies (test map stays empty for lighting/structure work); `?zombies=0` off.
    zombiesAwayFrom: boot.map !== 'test' && boot.zombies ? (spawn ?? { x: 0, y: 0 }) : undefined,
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
let firstSnapshot = true;
sim.onSnapshot(({ tick, buf }) => {
  stamper.tick = tick;
  if (firstSnapshot) {
    firstSnapshot = false;
    // Dev `?give=` / `?stat=`: starting items and stats (debug commands, need `init.dev`).
    if (import.meta.env.DEV) {
      for (const g of boot.give) sim.send(stamper.stamp({ type: 'debugGiveItem', ...g }));
      for (const st of boot.stats) sim.send(stamper.stamp({ type: 'debugStat', ...st }));
      const p0 = readEntity(buf, 0);
      if (boot.zspawn > 0 && p0) {
        sim.send(
          stamper.stamp({ type: 'debugSpawnZombie', x: p0.x + 2, y: p0.y, count: boot.zspawn }),
        );
      }
    }
  }
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

// HUD A (@deadzone/ui): DOM over the canvas, fed from the game state (spec deadzone-hud-spec §5).
const hud = createHud({
  root: container,
  bindings: () => settings.get().input.bindings,
  geometry: minimapGeometry(world.source, world.range),
  pois: world.zones
    .filter((z) => z.role === 'extraction')
    .flatMap((z) =>
      z.rects.map((r) => ({ x: r.x + r.w / 2, z: r.y + r.h / 2, kind: 'objective' as const })),
    ),
  onInteract: interact,
  playerId: PLAYER_ID,
});
// Zombie health (approved mockup): target bubble on Shift + LMB, bars over wounded (setting).
const zombieHp = new ZombieHpLayer(container, crowd);
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.shiftKey || !settings.get().interface.targetZombieHp) return;
  const ndc = clientToNdc(e.clientX, e.clientY, renderer.domElement.getBoundingClientRect());
  // Intersect at waist height: the cursor is on the body, not on the feet behind it.
  const hit = ndcToFloor(camera, ndc.x, ndc.y, PICK_PLANE_Y);
  if (hit) zombieHp.pickAt(hit.x, hit.z);
});
let hudContent: HudContentIndex = EMPTY_HUD_CONTENT;
if (boot.sim === 'worker') {
  void import('./content/base-pack.js').then((m) => {
    hudContent = buildHudContentIndex(m.baseFiles);
    hud.setContent(hudContent);
  });
}
// Baked item icons (tools/assets `icons`); vector icons until / unless they load.
void loadItemIcons();
// Inventory window (I / Esc): character + equipment, bags and the opened container.
const inventory = createInventoryWindow({
  root: container,
  send: (cmd) => sim.send(stamper.stamp(cmd)),
  state: () => gameState.get(),
  content: () => hudContent,
  keys: () => {
    const b = settings.get().input.bindings;
    return { takeAll: actionKey(b, 'reload'), putAll: actionKey(b, 'interact') };
  },
});
// Loot screen (mockup loot.png): opens by itself once a searched container's content arrives.
const loot = createLootWindow({
  root: container,
  send: (cmd) => sim.send(stamper.stamp(cmd)),
  state: () => gameState.get(),
  content: () => hudContent,
  onClose: () => {
    loot.hide();
    sim.send(stamper.stamp({ type: 'closeContainer' }));
  },
  onSwitch: (id) => sim.send(stamper.stamp({ type: 'openContainer', container: id })),
});
input.on('inventory', () => {
  if (loot.open) loot.hide();
  inventory.toggle();
});
input.on('pause', () => inventory.close());
input.on('reload', () => {
  if (inventory.open) inventory.takeAll();
});
const groundPiles = new GroundPiles();
scene.add(groundPiles.root);
const mapObjects = new MapObjects(world.source, world.range);
scene.add(mapObjects.root);
// CC0 models (tools/assets → public/models); grey placeholders stay until/unless they load.
let zombieViews: InstancedZombies | undefined;
void ModelKit.create(renderer).then(async (kit) => {
  if (!kit) return;
  mapObjects.applyModels((id, h) => {
    const model = CONTAINER_MODELS[id];
    return model ? kit.staticModel(model, h) : undefined;
  });
  groundPiles.pileModel = () => kit.staticModel(PILE_MODEL, 0.45) ?? new Group();
  try {
    const p = await kit.character(PLAYER_MODEL, PLAYER_HEIGHT);
    brighten(p.object);
    player.setModel(p.object, p.clips);
  } catch (e) {
    console.warn('player model', e);
  }
  const templates = await loadZombieTemplates(kit);
  if (templates.length) {
    zombieViews = await InstancedZombies.create(templates, crowd);
    scene.add(zombieViews.root);
    crowdView.mesh.visible = false;
  }
});
let deathShown = false;
gameState.subscribe((next) => {
  if (!next.death || deathShown) return;
  deathShown = true;
  player.dead = true;
  inventory.close();
  loot.hide();
  showDeathScreen(container, next.death, boot.map === 'test' ? 'test' : boot.map);
});
/** Interact key / button: search/open the nearest container, cancel the search, or close. */
function interact(): void {
  if (inventory.open) {
    inventory.putAll();
    return;
  }
  const p = snapshots.sample(performance.now(), TICK_MS);
  if (!p) return;
  const intent = interactIntent(gameState.get(), p.x, p.y);
  if (intent.type === 'open')
    sim.send(stamper.stamp({ type: 'openContainer', container: intent.container }));
  else if (intent.type === 'close') sim.send(stamper.stamp({ type: 'closeContainer' }));
  else if (intent.type === 'cancel') sim.send(stamper.stamp({ type: 'cancelAction' }));
}
input.on('interact', interact);
// Melee: LMB attacks towards the aim point (weapon in hand_primary or fists), RMB shoves.
input.on('primaryAction', () => {
  if (inventory.open || gameState.get().death) return;
  lastSwingMs = performance.now();
  sim.send(stamper.stamp({ type: 'attack' }));
});
input.on('secondaryAction', () => {
  if (inventory.open || gameState.get().death) return;
  lastSwingMs = performance.now();
  sim.send(stamper.stamp({ type: 'shove' }));
});
// Aiming (PZ-like): the body faces the cursor while a mouse action is held and shortly after a
// swing; otherwise it turns towards the movement (player/locomotion.ts). Shift is sprint.
const AIM_HOLD_MS = 700;
let lastSwingMs = -Infinity;
const isAiming = (now: number): boolean =>
  input.isDown('primaryAction') ||
  input.isDown('secondaryAction') ||
  now - lastSwingMs < AIM_HOLD_MS;
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
QUICKSLOTS.forEach((action, i) => input.on(action, () => hud.selectSlot(i)));
input.on('toggleHints', () => hud.toggleHints(performance.now()));
// F1 & co. open browser help otherwise.
window.addEventListener('keydown', (e) => {
  if (settings.get().input.bindings.toggleHints.includes(e.code)) e.preventDefault();
});
gameState.subscribe((_next, _prev, action) => {
  if (action.type === 'events') hud.events(action.events);
});
// Lamps: test map placeholder list. The look follows the sim clock through the day cycle
// (night approved; dawn/day/dusk are placeholders in lighting/day-cycle-config.ts).
const lighting = createWorldLighting(
  scene,
  renderer,
  boot.map === 'test' ? createTestLamps() : [],
  CAMERA_DISTANCE,
);
const dayCycle = new DayCycle(DAY_CYCLE);
const timeOverride = import.meta.env.DEV ? boot.time : undefined;
const bootMs = performance.now();
let lightMinute = DAY_CYCLE.fallbackMinute;
/** Minute of day for the lighting: dev override, else the sim clock between ticks. */
function currentMinute(now: number): number {
  if (timeOverride !== undefined) return overrideMinute(timeOverride, boot.timescale, now - bootMs);
  const clock = gameState.get().clock;
  if (!clock) return DAY_CYCLE.fallbackMinute;
  return clockMinute(clock, stamper.tick + Math.min(1, (now - crowdArrivedMs) / TICK_MS));
}

function resize(): void {
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  renderer.setSize(width, height);
  resizeIsometricCamera(camera, width / Math.max(height, 1), VIEW_HEIGHT);
  hud.resize(width, height);
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
        () =>
          `${bench.line()}\n${pos()}\n${devStateLine(gameState.get())}\n` +
          `light ${formatMinute(lightMinute)} · lamps ${lighting.lamps.currentLevel.toFixed(2)}`,
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
    player.aiming = isAiming(performance.now());
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
  lightMinute = currentMinute(performance.now());
  lighting.applyCompiled(dayCycle.sample(lightMinute), dayCycle.lampLevel(lightMinute));
  lighting.update(camera, rig.target.x, rig.target.z);
  const gs = gameState.get();
  groundPiles.update(gs.groundPiles, gs.nearby, time);
  mapObjects.update(gs.nearby, time);
  if (!inventory.open) loot.update();
  inventory.update();
  if (state) {
    const simTick = stamper.tick + Math.min(1, (performance.now() - crowdArrivedMs) / TICK_MS);
    hud.frame({
      now: performance.now(),
      state: gs,
      px: state.x,
      py: state.y,
      facing: state.facing,
      cameraYaw: rig.targetYaw,
      tick: simTick,
      minute: lightMinute,
      clock:
        timeOverride !== undefined
          ? { day: gs.clock?.day ?? 1, minuteOfDay: lightMinute }
          : gs.clock,
      interactHeld: input.isDown('interact'),
    });
  }
  const t0 = performance.now();
  const alpha = tickAlpha(t0, crowdArrivedMs, TICK_MS);
  if (zombieViews) zombieViews.update(alpha, t0 / 1000, camera, rig.target.x, rig.target.z);
  else crowdView.update(alpha);
  const ui = settings.get().interface;
  zombieHp.update(alpha, camera, container.clientWidth, container.clientHeight, {
    showWounded: ui.showZombieHp,
    targeting: ui.targetZombieHp,
  });
  const t1 = performance.now();
  renderer.render(scene, camera);
  frameSample.updateMs = t1 - t0;
  frameSample.renderMs = performance.now() - t1;
  recordFrame?.(frameSample, renderer);
  afterRender?.(renderer);
});
