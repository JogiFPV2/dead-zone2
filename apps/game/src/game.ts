import { coverChoices } from './hud/window-cover-items.js';
import { ArrowHelper, Group, Vector3, WebGLRenderer } from 'three';
import { computeUiScale } from '@deadzone/ui';
import {
  CAMERA_DISTANCE,
  createIsometricCamera,
  resizeIsometricCamera,
} from './camera/isometric.js';
import { CameraRig } from './camera/rig.js';
import { followStep } from './camera/follow.js';
import { bindCameraInput } from './input/camera-input.js';
import { TouchControls } from './input/touch/touch-controls.js';
import { DEFAULT_ZOOM_LIMITS } from './camera/zoom.js';
import { TOUCH_ZOOM_LIMITS, createMobileViewStore } from './hud/touch/mobile-view-store.js';
import {
  browserTouchEnv,
  lockLandscape,
  pixelRatioFor,
  touchSettings,
} from './input/touch/touch-settings.js';
import { autoAimTarget, AUTO_AIM_RANGE } from './input/touch/auto-aim.js';
import { createTouchHud } from './hud/touch/touch-hud.js';
import { MINIMAP_TOUCH_STEPS, radiusLabel, touchMinimapZoom } from './hud/touch/minimap-levels.js';
import { INV2_CLASS, inventoryV2Enabled } from './hud/inv3/inv2-flag.js';
import { MapRevealer, revealFlag } from './bigmap/reveal-flag.js';
import { createTouchZoomSlider } from './hud/touch/zoom-slider.js';
import { InteractController } from './hud/v2/interact-controller.js';
import { createBigMap } from './bigmap/bigmap-view.js';
import { renderPaper } from './bigmap/paper.js';
import { SimBigMapSource } from './bigmap/sim-source.js';
import { NO_BUILDING } from './world/chunk.js';
import { QUICK_ACCESS, QUICK_ACCESS_READY, type QuickAccessId } from './hud/v2/quick-access.js';
import { InputMap } from './input/input-map.js';
import { PlayerInput } from './input/player-input.js';
import { SneakToggle } from './input/sneak-toggle.js';
import { AudioEngine } from './audio/audio-engine.js';
import { Footsteps, WORLD_SOUNDS, eventCues } from './audio/world-sfx.js';
import { SETTINGS_STORAGE_KEY, createSettingsStore, loadSettings } from './settings/store.js';
import { LocalPlayerSettingsStore } from './settings/player-settings-store.js';
import { installHudLayout } from './hud/layout/hud-layout-runtime.js';
import { displayName } from './characters/display-name.js';
import { GraphicsStylePass, isPixelStyle, pixelRows } from './render/graphics-style.js';
import { NoiseRingModel } from './hud/noise/noise-model.js';
import { NoiseRingView } from './hud/noise/noise-ring.js';
import { addHulls } from './render/style-materials.js';
import type { GraphicsStyle } from './settings/schema.js';
import { debounced } from './settings/debounce.js';
import { PlayerView } from './player/player-view.js';
import { createScene } from './scene.js';
import {
  DAY_CYCLE,
  DayCycle,
  applySun,
  sunForClock,
  clockMinute,
  createWorldLighting,
  formatMinute,
  overrideMinute,
} from './lighting/index.js';
import { createTestLamps } from './world/test-lamps.js';
import { simToWorld } from './sim/coords.js';
import { SnapshotBuffer } from './sim/interpolate.js';
import type { ActionView, CharacterView, EquipSlot, ItemId } from '@deadzone/protocol';
import { SnapshotEntityKind, TARGET_MAX_TILES } from '@deadzone/protocol';
import { SAVE_VERSION, TICK_MS } from '@deadzone/sim';
import type { CloudPlay } from './account/cloud-play.js';
import { MockSimClient } from './sim/mock-sim-client.js';
import { SimStreamSync } from './world/streaming/sim-sync.js';
import { CommandStamper, type CommandBody } from './sim/sim-client.js';
import { readEntity } from './sim/snapshot.js';
import { TEST_MAP_RANGE, createTestMap, rangeBounds } from './world/test-map.js';
import { tileOf } from './world/building-lookup.js';
import { cameraSide, occludersOf } from './world/cutaway.js';
import { FrameSections } from './dev/frame-sections.js';
import { furnitureFootprintsFromFiles, isRealScale } from './world/furniture-footprint.js';
import {
  createWorldStreaming,
  fitSmallWorld,
  streamConfigFor,
  wholeWorldNear,
} from './world/streaming/setup.js';
import { chunkSourceToWorld, type LoadedChunks } from './world/streaming/source.js';
import type { OpeningsLike } from './world/gen/streamed-town.js';
import { FollowWindow } from './world/gen/follow-window.js';
import { genStartRange, nearestPlace } from './world/gen/maps.js';
import { CHUNK_SIZE } from './world/chunk.js';
import { OpeningsView } from './world/openings.js';
import {
  doorWins,
  nearestDoor,
  openingPrimary,
  OpeningFeedback,
  type DoorTarget,
  type OpeningCmd,
  doorCentre,
  type DoorEdge,
} from './world/door-target.js';
import { BuildingLookup } from './world/building-lookup.js';
import { SimFloorIntel } from './floors/floor-intel.js';
import { createFloors } from './floors/floors-controller.js';
import { TEST_BUILDING_INSIDE } from './world/test-building.js';
import { CrowdBuffer } from './crowd/crowd-buffer.js';
import { startAnimalCount } from './animals/animal-count.js';
import { animalTypeIds } from './animals/animal-species.js';
import { AnimalViews, loadAnimalTemplates } from './animals/animal-views.js';
import { CrowdView } from './crowd/crowd-view.js';
import { parseBootOptions } from './boot-options.js';
import { startSimWorker } from './sim/start-sim.js';
import { takeNewCharacter, takeSession } from './session.js';
import { CharacterSaver, refusalText } from './characters/session-saver.js';
import type { RenderLook } from './creator/appearance-map.js';
import { GameStateStore, connectSimState } from './state/game-state.js';
import { describeEvent, devStateLine } from './state/format.js';
import type { SimClient } from './sim/sim-client.js';
import type { LoadedMap } from './world/content-map.js';
import { startSpawn } from './world/zones.js';
import { tickAlpha } from './sim/interpolate.js';
import type { FrameSample } from './dev/frame-bench.js';
import { createHud } from './hud/hud.js';
import { PICK_PLANE_Y, ZombieHpLayer } from './hud/zombie-hp.js';
import { nextTargetId } from './hud/target-card-model.js';
import { RmbGesture } from './input/rmb-gesture.js';
import { allowsNativeContextMenu } from './input/context-menu.js';
import { createAimReticle } from './hud/aim-reticle.js';
import { SPREAD_WARN, reticleRadius } from './hud/firearm-model.js';
import { clientToNdc, ndcToFloor } from './input/aim.js';
import { interactIntent } from './hud/hud-model.js';
import { minimapGeometry } from './hud/minimap-data.js';
import {
  EMPTY_HUD_CONTENT,
  buildHudContentIndex,
  type HudContentIndex,
} from './hud/content-index.js';
import { createInventoryV3 } from './hud/inv3/inventory-v3.js';
import { VehicleController } from './vehicles/vehicle-controller.js';
import { createVehicleHud } from './vehicles/vehicle-hud.js';
import { VehicleView } from './vehicles/vehicle-view.js';
import { FUEL_PUMP, withPumps } from './vehicles/dev-pumps.js';
import { OSM_ATTRIBUTION, osmScene, sceneZombies, withSceneVehicles } from './world/osm/scenes.js';
import type { SnapshotVehicle } from '@deadzone/protocol';
import { createLootWindow } from './hud/loot-window.js';
import { createWorkshopWindow } from './hud/workshop-window.js';
import { createSleepController } from './hud/sleep-controller.js';
import {
  SPOT_RADIUS_TILES,
  leisureSpots,
  mapObjectsOf,
  sleepSurfaceAt,
  type LeisureSpot,
} from './hud/leisure-spots.js';
import { FurnitureUi } from './hud/furniture/furniture-ui.js';
import { SimFurnitureSource } from './hud/furniture/sim-source.js';
import { levelWindowKeys, litWindowKeys } from './world/lit-windows.js';
import type { SleepSurface } from './hud/sleep-settings.js';
import { LEVEL_HEIGHT } from './world/instances.js';
import { loadItemIcons } from './hud/item-icons.js';
import { actionKey } from './hud/key-label.js';
import { showDeathScreen } from './death/death-screen.js';
import { GroundPiles } from './world/ground-piles.js';
import { ShelfFill } from './world/shelf-fill.js';
import {
  CONTAINER_MODELS,
  ModelKit,
  PILE_MODEL,
  characterModels,
  ktx2For,
} from './models/model-kit.js';
import { brighten, lightReal, loadZombieTemplates } from './models/zombie-views.js';
import { InstancedZombies } from './models/instanced-zombies.js';
import { PLAYER_HEIGHT } from './player/player-view.js';
import { PhysAdapter } from './anim/phys-adapter.js';
import { buildWeaponIndex, type WeaponInfo } from './weapons/weapon-kinds.js';
import { WeaponModels } from './weapons/weapon-models.js';
import { devHoldWeapon, weaponLoadout } from './weapons/loadout.js';
import { MENU_TRACK } from './menu/track.js';
import { PauseController } from './pause/pause-controller.js';
import { FloatingOrigin, chunkCorner } from './render/floating-origin.js';
import { SaveRefusedError, handleEscape, type Closable } from './pause/pause-model.js';
import type { WorkerSimClient } from './sim/worker-sim-client.js';
import { bindUiScale, scaledUi } from './ui/ui-scale.js';

const VIEW_HEIGHT = 24;
const QUICKSLOTS = ['quickslot1', 'quickslot2', 'quickslot3', 'quickslot4', 'quickslot5'] as const;
/** Singleplayer: the local player is sim player 0. */
const PLAYER_ID = 0;
const SIM_SEED = 1;
const FOLLOW_HALF_LIFE_MS = 80;
/** Stress world edge in tiles (8 km); kept here so the stress module stays lazy. */

/** The game itself (the default page); imported by main.ts. */
function localStorageOrUndefined(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

// Phones / tablets (or `?touch=1`, Ustawienia › Sterowanie › Tryb sterowania): touch controls,
// `quality=low` unless the URL sets it, DPR 1.5–2, landscape where the browser lets us lock it.
const touchMode = touchSettings(
  window.location.search,
  browserTouchEnv(),
  loadSettings(localStorageOrUndefined()?.getItem(SETTINGS_STORAGE_KEY) ?? null).settings.input
    .touchMode,
);
document.documentElement.classList.toggle('is-touch', touchMode.touch);
// Inventory v2 phone layout (`?inv=v2`, default off until approved).
document.documentElement.classList.toggle(INV2_CLASS, inventoryV2Enabled(window.location.search));
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(
  pixelRatioFor(
    window.devicePixelRatio,
    touchMode.touch,
    touchMode.quality ??
      (new URLSearchParams(window.location.search).get('quality') === 'low' ? 'low' : 'medium'),
  ),
);
container.appendChild(renderer.domElement);

/** The character from the menu (its world, its save slot); none for dev/test URLs. */
const session = takeSession();
const settings = createSettingsStore();
// „Styl grafiki: Realistyczny” (Ustawienia › Grafika) picks the render style; `?style=real|classic` wins.
const parsedBoot = parseBootOptions(window.location.search, settings.get().graphics.renderStyle);
if (touchMode.quality) parsedBoot.render.quality = touchMode.quality;
/** Landscape lock took (`screen.orientation.lock`); otherwise only `touchMode.landscape` says so. */
let landscapeLocked = false;
if (touchMode.landscape) {
  const tryLock = () =>
    void lockLandscape().then((ok) => {
      landscapeLocked ||= ok;
    });
  tryLock();
  // Most browsers lock only after a user gesture (or in fullscreen): once more on the first touch.
  window.addEventListener('pointerdown', tryLock, { once: true });
}
// A character plays in its own world: its map and seed.
const boot = session ? { ...parsedBoot, map: session.character.worldSettings.map } : parsedBoot;
// Shader info logs force a synchronous compile wait on every new program: dev builds only.
renderer.debug.checkShaderErrors = import.meta.env.DEV && !boot.perf;
const simSeed = session?.character.worldSeed ?? SIM_SEED;
// `?style=real` or „Styl grafiki: Realistyczny” (render.style = 'real'): realistic PBR pilot.
// Off by default: nothing of it loads and the frame goes through `stylePass` exactly as before.
const realStyle =
  boot.render.style === 'real'
    ? await import('./render/real/real-style.js')
        .then((m) =>
          m.RealStyle.load(
            renderer,
            ktx2For(renderer),
            boot.render.quality,
            import.meta.env.BASE_URL,
          ),
        )
        .catch((e: unknown) => {
          console.error('Realistic style failed to load; default look', e);
          return undefined;
        })
    : undefined;
/** New game from the creator (menu / `?creator=1`); undefined = default character or a save. */
const newCharacter = session ? session.created : takeNewCharacter();
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
// `?stress=1`: procedural 8 × 8 km dummy world, streamed only (no sim map: the mock sim walks it;
// minimap, shelf props and leisure spots see an empty map).
const stressWorld = boot.stress
  ? await import('./world/streaming/stress-source.js').then(
      (m) => new m.StressWorldSource(SIM_SEED, boot.stressLatencyMs, boot.stressChunks),
    )
  : undefined;
// Generated maps (`?map=osm-stw`, `?map=plan-4`; tools/map/src/world-source/README.md): chunks generated lazily
// from a world plan in a worker, streamed with the town kit; the sim runs on the same plan.
const genWorld = stressWorld
  ? undefined
  : await import('./world/gen/open.js').then((m) =>
      m.openGeneratedWorld(boot.map, window.location.search, import.meta.env.BASE_URL),
    );
/** The streamer's loaded chunks (generated maps: the synchronous view of the world). */
const loadedChunks: { current?: LoadedChunks } = {};
const loadedWorld: LoadedMap = genWorld
  ? {
      source: {
        tilePalette: genWorld.source.tilePalette,
        edgePalette: genWorld.source.edgePalette,
        getChunk: (cx, cy, z) => loadedChunks.current?.getChunk(cx, cy, z),
      },
      // Start window only: the whole-map consumers (minimap, paper map, beds / sofas, shelf
      // fill) follow the player (`follow` below); the world itself streams without limits.
      range: genStartRange(genWorld.source.bounds, genWorld.source.info.start, 8),
      zones: [],
    }
  : stressWorld
    ? {
        source: { tilePalette: [null], getChunk: () => undefined },
        range: { cx0: 0, cy0: 0, cx1: 0, cy1: 0, z: 0 },
        zones: [],
      }
    : boot.map !== 'test'
      ? await import('./world/load-content-map.js').then((m) => m.loadBaseMap(boot.map))
      : { source: createTestMap(), range: TEST_MAP_RANGE, zones: [] };
/** Generated maps: the chunk window of the whole-map consumers, following the player. */
const follow = genWorld
  ? new FollowWindow(genWorld.source.bounds, genWorld.source.info.start, 8)
  : undefined;
/** Storeys the whole-map consumers read (generated maps stream every storey per chunk). */
const consumerLevels = (z: number): number[] =>
  genWorld ? Array.from({ length: genWorld.source.levels.max + 1 }, (_, i) => i) : [z];
// OSM scenes (`?map=osm-okulickiego`): parked cars, framed zombies and trees from the scene file.
const osm = stressWorld ? undefined : osmScene(boot.map);
const sceneWorld: LoadedMap = osm
  ? { ...loadedWorld, source: withSceneVehicles(loadedWorld.source, osm) }
  : loadedWorld;
// Dev `?pump=x,y`: fuel pumps on the map (vehicle UI testing; no map has one yet).
const pumpedWorld: LoadedMap =
  import.meta.env.DEV && boot.pumps.length
    ? { ...sceneWorld, source: withPumps(sceneWorld.source, boot.pumps) }
    : sceneWorld;
// Dev `?tv=x,y`: TVs on the map (furniture UI testing; no content map has one yet).
const world: LoadedMap =
  import.meta.env.DEV && boot.tvs?.length
    ? { ...pumpedWorld, source: withPumps(pumpedWorld.source, boot.tvs, 'base:tv') }
    : pumpedWorld;
// OSM maps: ODbL attribution always on screen (over the world, the minimap and the big map).
if (osm || genWorld?.source.info.attribution) {
  const attribution = document.createElement('div');
  attribution.className = 'dz-osm-attribution';
  attribution.textContent = genWorld?.source.info.attribution ?? OSM_ATTRIBUTION;
  Object.assign(attribution.style, {
    position: 'fixed',
    right: '8px',
    bottom: '4px',
    font: '11px Inter, system-ui, sans-serif',
    color: 'rgba(255, 255, 255, 0.78)',
    textShadow: '0 1px 2px #000',
    pointerEvents: 'none',
    zIndex: '60',
  });
  document.body.appendChild(attribution);
}
/** Where the player starts (streaming warm-up centre before the first snapshot). */
const startPoint: { x: number; y: number } = stressWorld
  ? import.meta.env.DEV && boot.spawnAt
    ? boot.spawnAt
    : stressWorld.centre
  : genWorld
    ? import.meta.env.DEV && boot.spawnAt
      ? boot.spawnAt
      : genWorld.source.info.start
    : boot.spawnInside
      ? TEST_BUILDING_INSIDE
      : import.meta.env.DEV && boot.spawnAt
        ? boot.spawnAt
        : (startSpawn(world.zones) ?? (boot.sim === 'mock' ? { x: 6.5, y: 6.5 } : { x: 0, y: 0 }));

const scene = createScene();
// Floating origin (render/floating-origin.ts): world content hangs under `worldRoot`, drawn around
// a render origin near the player; the camera and the sun work in render space.
const floating = new FloatingOrigin();
const worldRoot = floating.root;
scene.add(worldRoot);
for (const o of [...scene.children]) if (o !== worldRoot) worldRoot.add(o);
// Whole settings object (`hud` = the HUD editor layout, deadzone.hudLayout; cloud copy via
// account/settings-sync.ts when signed in).
const playerSettings = new LocalPlayerSettingsStore(settings, localStorageOrUndefined());
// „Skala interfejsu” for every UI layer, following the stored setting.
bindUiScale(settings);
// Town kit (CC0 modules, one atlas material): BatchedMesh per chunk + merged terrain per chunk.
// `?town=0` or a failed load keeps the grey-box world. The kit lays out the whole authored map at
// once, so it is not streamed yet; the stress world always uses the streamed grey-box layers.
const townKit =
  boot.town && !stressWorld
    ? await import('./world/town/kit.js')
        .then((m) => m.loadTownKit())
        .then((kit) => (realStyle ? realStyle.townKit(kit) : kit))
        .catch((e: unknown) => {
          console.error('Town kit failed to load; grey-box world', e);
          return undefined;
        })
    : undefined;
const town = townKit ? await import('./world/town/index.js') : undefined;
// Procedural decor of content maps (lamps, poles, trees); the generated test map has its own lamps.
const decor =
  boot.map !== 'test' && town && !genWorld
    ? town.townDecor(new town.MapTiles(world.source, world.range.z), world.range, osm?.trees)
    : undefined;
// Chunk streaming (docs/streaming.md): grey-box terrain / structures and map objects load per
// chunk around the player / camera target; mid and far rings get merged LOD meshes.
const streaming = createWorldStreaming(
  stressWorld ??
    genWorld?.source ??
    chunkSourceToWorld(world.source, world.range, `content:${boot.map}`, SIM_SEED),
  streamConfigFor(settings.get().graphics.viewDistance, window.location.search),
  { greyBox: !townKit, streamed: !!genWorld, decor: !(genWorld && townKit) },
);
loadedChunks.current = streaming.streamer.loaded;
// Perf probe of generated maps (chunk generation / round-trip times, streamer stats).
if (genWorld) {
  (globalThis as Record<string, unknown>).__dzWorldGen = {
    info: genWorld.source.info,
    chunkStats: genWorld.source.stats,
    streamStats: () => streaming.streamer.stats(),
    townBuildMs: () => streamedTown?.buildMs ?? [],
    /** Last frame's draw calls + visible meshes per top-level group (shadow passes included). */
    draws: () => {
      const groups: Record<string, number> = {};
      worldRoot.traverseVisible((o) => {
        if (!(o as { isMesh?: boolean }).isMesh) return;
        let top = o;
        while (top.parent && top.parent !== worldRoot) top = top.parent;
        const k = `${top.name || top.type}/${o.name.replace(/[\d:,@.-]+/g, '')}${(o as { isInstancedMesh?: boolean }).isInstancedMesh ? '[i]' : ''}${o.castShadow ? '+s' : ''}`;
        groups[k] = (groups[k] ?? 0) + 1;
      });
      return { calls: renderer.info.render.calls, groups };
    },
    /**
     * Draw calls of the next frame per group (main pass and shadow passes), read later from
     * `__dzWorldGen.lastFrameDraws` (dev perf).
     */
    captureFrameDraws: () => {
      const main: Record<string, number> = {};
      const shadow: Record<string, number> = {};
      type Hooked = {
        onBeforeRender: (...a: unknown[]) => void;
        onBeforeShadow: (...a: unknown[]) => void;
      };
      const restore: (() => void)[] = [];
      worldRoot.traverse((o) => {
        if (!(o as { isMesh?: boolean }).isMesh) return;
        let top = o;
        while (top.parent && top.parent !== worldRoot) top = top.parent;
        const geo = (o as { geometry?: { type?: string } }).geometry?.type ?? '';
        const k = `${top.name || top.type}/${o.name.replace(/[\d:,@.-]+/g, '') || `~${geo}`}`;
        const h = o as unknown as Hooked;
        const r0 = h.onBeforeRender;
        const s0 = h.onBeforeShadow;
        h.onBeforeRender = function (this: unknown, ...a: unknown[]) {
          main[k] = (main[k] ?? 0) + 1;
          r0.apply(this, a);
        };
        h.onBeforeShadow = function (this: unknown, ...a: unknown[]) {
          shadow[k] = (shadow[k] ?? 0) + 1;
          s0.apply(this, a);
        };
        restore.push(() => {
          h.onBeforeRender = r0;
          h.onBeforeShadow = s0;
        });
      });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          for (const r of restore) r();
          const g = globalThis as { __dzWorldGen?: Record<string, unknown> };
          if (g.__dzWorldGen)
            g.__dzWorldGen.lastFrameDraws = { calls: renderer.info.render.calls, main, shadow };
        }),
      );
    },
  };
}
settings.subscribe((next, prev) => {
  if (next.graphics.viewDistance !== prev.graphics.viewDistance) {
    const cfg = streamConfigFor(next.graphics.viewDistance, window.location.search);
    const b = streaming.streamer.source.bounds;
    streaming.streamer.setConfig(
      genWorld ? cfg : townKit ? wholeWorldNear(cfg, b) : fitSmallWorld(cfg, b),
    );
  }
});
// Generated maps with the town kit: kit terrain / walls / roofs / doors per streamed chunk.
const genLayers = genWorld ? await import('./world/gen/streamed-town.js') : undefined;
const streamedTown =
  genLayers && townKit
    ? new genLayers.StreamedTown(
        streaming.streamer.loaded,
        townKit,
        realStyle ? (b) => realStyle.buildingShell(b) !== undefined : undefined,
      )
    : undefined;
if (streamedTown) {
  streaming.lod.addNearLayer({
    loadChunk: (cx, cy, z) => streamedTown.loadChunk(cx, cy, z),
    unloadChunk: (cx, cy, z) => streamedTown.unloadChunk(cx, cy, z),
  });
  worldRoot.add(streamedTown.root);
}
// Generated maps: power lines, railway and catenary per near chunk (Designer's infra models).
if (genWorld && !stressWorld) {
  void import('./world/infra/kit.js')
    .then(async (m) => {
      const { InfraLayer } = await import('./world/infra/infra-layer.js');
      const layer = new InfraLayer(await m.loadInfraKit());
      worldRoot.add(layer.root);
      const loaded = streaming.streamer.loaded;
      streaming.lod.addNearLayer({
        loadChunk: (cx, cy, z) => {
          if (z === 0) layer.loadChunk(cx, cy, loaded.column(cx, cy)?.infra);
          return { bytes: 0, triangles: 0 };
        },
        unloadChunk: (cx, cy, z) => {
          if (z === 0) layer.unloadChunk(cx, cy);
        },
      });
    })
    .catch((e: unknown) => console.error('Infra models failed to load', e));
}
// Realistic style: Designer's blocks, houses, bin shelters and bushes per near chunk (one
// InstancedMesh per model); shelled buildings hide their kit pieces until the cutaway opens them.
const realMap = realStyle && townKit && !stressWorld ? realStyle.mapLayer() : undefined;
if (realStyle && realMap) {
  const loaded = streaming.streamer.loaded;
  streaming.lod.addNearLayer({
    loadChunk: (cx, cy, z) => {
      const col = z === 0 ? loaded.column(cx, cy) : undefined;
      if (col) realMap.loadChunk(cx, cy, realStyle.chunkModels(col));
      return { bytes: 0, triangles: 0 };
    },
    unloadChunk: (cx, cy, z) => {
      if (z === 0) realMap.unloadChunk(cx, cy);
    },
  });
  worldRoot.add(realMap.root);
}
const streamedOpenings = genLayers
  ? new genLayers.StreamedOpenings(streaming.streamer.loaded, streamedTown, townKit)
  : undefined;
if (streamedOpenings) {
  streaming.lod.addNearLayer({
    loadChunk: (cx, cy, z) => streamedOpenings.loadChunk(cx, cy, z),
    unloadChunk: (cx, cy, z) => streamedOpenings.unloadChunk(cx, cy, z),
  });
}
if (townKit && town && !genWorld) {
  const terrain = new town.TownTerrain(world.source, townKit);
  terrain.loadRange(world.range);
  worldRoot.add(terrain.root);
}
const townStructures =
  townKit && town && !genWorld ? new town.TownStructures(world.source, townKit) : undefined;
if (townStructures) {
  townStructures.loadRange(world.range, decor?.props);
  worldRoot.add(townStructures.root);
}
const structures = townStructures ?? streamedTown ?? streaming.structures;
// Upper floors (z = 1..): one town batch set per level with chunks, drawn at z · floor height
// (slabs with stair openings, flights of stairs). The sim reads the same chunks by (cx, cy, z).
const upperTown: NonNullable<typeof townStructures>[] =
  townKit && town && !genWorld ? town.loadUpperLevels(world.source, world.range, townKit) : [];
for (const level of upperTown) worldRoot.add(level.root);
for (const root of streaming.roots) worldRoot.add(root);
await streaming.streamer.warmup([startPoint]);
// Doors, window panes and fences: sim opening state + shaking under crowd pressure. Not streamed
// yet: built over the authored map (empty in the stress world), see docs/streaming.md.
const openings: OpeningsLike =
  streamedOpenings ??
  new OpeningsView(
    world.source,
    townStructures?.lookup ?? new BuildingLookup(world.source),
    townKit && townStructures && town
      ? {
          kit: townKit,
          leafOf: (e) =>
            town.doorLeaf(
              townStructures.doorSkin(e.tx, e.ty, e.side === 'n' ? 'N' : 'W') ?? 'interior',
            ),
          onWindow: (e, state) =>
            townStructures.setWindowBroken(
              e.tx,
              e.ty,
              e.side === 'n' ? 'N' : 'W',
              state === 'broken',
            ),
        }
      : undefined,
  );
if (openings instanceof OpeningsView) openings.loadRange(world.range);
worldRoot.add(openings.root);
if (import.meta.env.DEV && boot.zones) {
  void import('./dev/zones-overlay.js').then(({ createZonesOverlay }) =>
    worldRoot.add(createZonesOverlay(world.zones)),
  );
}
const camera = createIsometricCamera({ aspect: 1, viewHeight: VIEW_HEIGHT });
// Phone: own zoom range (0.6×–2.0×) and view state in dz.mobile.* keys (migrated from settings).
const mobileView = touchMode.touch
  ? createMobileViewStore(globalThis.localStorage, {
      cameraZoom: settings.get().view.cameraZoom,
      minimapZoom: settings.get().view.minimapZoom,
      bigMapZoom: settings.get().view.bigMapZoom,
    })
  : undefined;
const zoomLimits = mobileView ? TOUCH_ZOOM_LIMITS : DEFAULT_ZOOM_LIMITS;
const rig = new CameraRig(camera, undefined, zoomLimits);
rig.origin = floating;
// The render camera moved by +origin: picking, HUD anchors and culling in world coordinates.
const worldCamera = camera.clone();
floating.set(...chunkCorner(startPoint.x, startPoint.y));
floating.onShift((o) => streaming.mapObjects.setOrigin(o.x, o.z));
streaming.mapObjects.setOrigin(floating.x, floating.z);
// Realistic style: dumpsters stand under Designer's bin shelters (their markers stay).
if (realMap && realStyle?.hasShelters) streaming.mapObjects.setHiddenKinds(['base:dumpster']);
// „Styl grafiki” (#71): post-process on the same scene, switched live from the settings.
const stylePass = new GraphicsStylePass(renderer);
stylePass.setStyle(settings.get().graphics.style);
settings.subscribe((next) => stylePass.setStyle(next.graphics.style));
// World one-shots (footsteps, melee hits, doors) on the effects bus of the #63 mixer.
const audio = new AudioEngine(settings, import.meta.env.BASE_URL);
audio.setInMenu(false);
audio.preload(...WORLD_SOUNDS);
const footsteps = new Footsteps();
const input = new InputMap(settings.get().input.bindings, {
  window,
  element: renderer.domElement,
  document,
});
settings.subscribe((next) => input.setBindings(next.input.bindings));
// Wheel zoom (smooth, 0.6×–1.6×), remembered in settings; not while a window is open.
if (mobileView) {
  rig.setZoom(mobileView.get('cameraZoom'));
  rig.onZoomTarget = (z) => mobileView.set('cameraZoom', z);
  window.addEventListener('pagehide', () => mobileView.flush());
} else {
  rig.setZoom(settings.get().view.cameraZoom);
  rig.onZoomTarget = debounced(400, (cameraZoom: number) =>
    settings.update((s) => ({ ...s, view: { ...s.view, cameraZoom } })),
  );
}
const cameraInput = bindCameraInput(rig, input, () => !!container.dataset.modal);

// Real sim in a Web Worker. TEMPORARY: the mock stays for `?crowd=N` (no NPCs in the sim yet;
// they come with zombies); it has no collisions and no survival.
const gameState = new GameStateStore();
let sim: SimClient;
/** The real sim (saves); undefined with the mock. */
let simWorker: WorkerSimClient | undefined;
if (boot.sim === 'worker') {
  const spawn = boot.spawnInside
    ? { ...TEST_BUILDING_INSIDE, z: 0 }
    : import.meta.env.DEV && boot.spawnAt
      ? { x: boot.spawnAt.x, y: boot.spawnAt.y, z: boot.spawnAt.z ?? 0 }
      : genWorld
        ? { x: genWorld.source.info.start.x, y: genWorld.source.info.start.y, z: 0 }
        : startSpawn(world.zones);
  const worker = startSimWorker(world.source, world.range, simSeed, {
    spawn,
    // Content maps get zombies (test map stays empty for lighting/structure work); `?zombies=0` off.
    zombiesAwayFrom: boot.map !== 'test' && boot.zombies ? (spawn ?? { x: 0, y: 0 }) : undefined,
    ...(osm && boot.zombies ? { zombies: sceneZombies(osm) } : {}),
    // Generated maps: zombies framed around the start; the sim's LOD fills every chunk it wakes
    // (zombies on every floor, loot, crates, parked cars).
    ...(genWorld
      ? {
          world: genWorld.spec,
          zombies: boot.zombies
            ? genWorld.source.info.zombies.map((z) => ({ x: z.x, y: z.y, z: 0 }))
            : [],
        }
      : {}),
    // Animals by habitat (towns: cats, dogs, birds; open land: deer, rabbits). Generated worlds:
    // around the start (the sim populates the chunks near the player, not the whole map).
    populateAnimals:
      boot.map === 'test'
        ? 0
        : startAnimalCount(
            genWorld
              ? genStartRange(genWorld.source.bounds, genWorld.source.info.start, 4)
              : world.range,
            boot.animals,
          ),
    content: await simContent,
    character: newCharacter?.spec,
    save: session?.save?.data,
    onWorkerError: (message) => loadFailed(message),
    dev: import.meta.env.DEV,
    // Local single-player sim: the test map reveal (?reveal=1 / settings) may run in prod.
    allowRevealMap: true,
    // Dev `?car=x,y,…`: parked cars (no map has cars yet).
    ...(import.meta.env.DEV && boot.cars.length ? { vehicles: boot.cars } : {}),
  });
  worker.onError((message) => loadFailed(message));
  connectSimState(gameState, worker);
  sim = worker;
  simWorker = worker;
} else {
  sim = new MockSimClient(
    stressWorld
      ? {
          minX: 0,
          minY: 0,
          maxX: boot.stressChunks * CHUNK_SIZE,
          maxY: boot.stressChunks * CHUNK_SIZE,
        }
      : rangeBounds(world.range),
    stressWorld ? startPoint : boot.spawnInside ? TEST_BUILDING_INSIDE : { x: 6.5, y: 6.5 },
    PLAYER_ID,
    { count: boot.crowd, seed: SIM_SEED },
  );
}
// Big map (M) data: the sim's player map (fog bitmap, trail, markers). Subscribed right after the
// sim starts so the first view (bounds + discovered + trail + markers) is not missed.
/** The player's floor (body level), updated every frame: new map markers go there. */
let playerFloor = 0;
const bigMapSource = new SimBigMapSource(
  (cmd) => sendBody(cmd),
  () => PLAYER_ID,
  (text) => hud.toast(text),
  () => playerFloor,
);
// Floor intel (protocol 22): rooms seen / searched, sensed zombies, sightings; marker floors.
const floorIntel = new SimFloorIntel((id) => bigMapSource.markers().find((m) => m.id === id)?.z);
// Test: `?reveal=1` / `?reveal=all` / settings toggle → sim debugRevealMap once (whole map).
const mapRevealer = new MapRevealer(
  () => sendBody({ type: 'debugRevealMap' }),
  revealFlag(window.location.search) || settings.get().interface.revealMap,
);
settings.subscribe((next) => mapRevealer.setWanted(next.interface.revealMap));
simWorker?.onView((view) => {
  bigMapSource.applyView(view.worldMap);
  if (view.worldMap) mapRevealer.worldReady();
  floorIntel.applyView(view);
});
simWorker?.onEvents((events) => bigMapSource.applyEvents(events));
// The character's single save slot: exit, daily autosave and after-sleep saves all go there.
let saver: CharacterSaver | undefined;
/** Account character (`?online=1` / mock): saves go to the cloud slot (account/cloud-play.ts). */
let cloudPlay: CloudPlay | undefined;
if (session?.cloud && simWorker) {
  const { CloudPlay, menuUrlOf, CLOUD_RETURN_KEY } = await import('./account/cloud-play.js');
  cloudPlay = new CloudPlay({
    session: { ...session, cloud: session.cloud },
    formatVersion: SAVE_VERSION,
    settings: playerSettings,
    host: {
      root: container,
      setPaused: (paused) => {
        sim.setPaused(paused);
        input.setSuspended(paused);
      },
      goToMenu: (back) => {
        try {
          window.sessionStorage.setItem(CLOUD_RETURN_KEY, JSON.stringify(back));
        } catch {
          // Storage disabled: plain menu.
        }
        window.location.assign(menuUrlOf(window.location.pathname, window.location.search));
      },
    },
  });
  const cloud = cloudPlay;
  // Review (mock account only): `&autosave=N` makes one save N s after the start, so the
  // conflict window of `&save=conflict` can be seen in game without waiting for 06:00.
  const reviewSaveSec = Number(new URLSearchParams(window.location.search).get('autosave'));
  if (session.cloud.api.mode === 'mock' && reviewSaveSec > 0) {
    const w = simWorker;
    setTimeout(() => void w.save('manual').catch(() => undefined), reviewSaveSec * 1000);
  }
  simWorker.onSaved((save) => {
    if (save.reason === 'exit') return;
    void cloud
      .autosave({
        tick: save.tick,
        day: save.day,
        minuteOfDay: lightMinute,
        reason: save.reason,
        data: save.buf,
      })
      .catch((e: unknown) => console.error('Zapis postaci w chmurze nie powiódł się', e));
  });
} else if (session && simWorker) {
  const { characterStore } = await import('./characters/open-store.js');
  const s = session.save;
  saver = new CharacterSaver(
    await characterStore(),
    session.character.id,
    s?.version ?? 0,
    s ? { day: s.day, minuteOfDay: s.minuteOfDay ?? undefined, savedAt: s.savedAt } : undefined,
  );
  const slot = saver;
  simWorker.onSaved((save) => {
    // `exit` is written by Zapisz i wyjdź itself (it waits for the result).
    if (save.reason === 'exit') return;
    void slot
      .write({
        tick: save.tick,
        day: save.day,
        minuteOfDay: lightMinute,
        reason: save.reason,
        data: save.buf,
      })
      .then((r) => {
        if (!r.ok) console.warn(`Zapis (${save.reason}) pominięty: ${refusalText(r.reason)}`);
      })
      .catch((e: unknown) => console.error('Zapis postaci nie powiódł się', e));
  });
}
let loadFailedShown = false;
/** The worker failed to start; with a save that means the save did not load. */
function loadFailed(message: string): void {
  if (!session?.save || loadFailedShown || gameState.get().clock) return;
  loadFailedShown = true;
  void import('./characters/load-error.js').then((m) =>
    m.showLoadError(container!, session.character.name, message),
  );
}
gameState.subscribe((_next, _prev, action) => {
  if (action.type === 'error') console.error(`Sim error: ${action.message}`);
  else if (import.meta.env.DEV && action.type === 'events') {
    for (const e of action.events) console.debug(`[sim t${e.tick}] ${describeEvent(e)}`);
  }
});
const stamper = new CommandStamper(PLAYER_ID);
// Chunk streaming ↔ sim (docs/sim-architecture.md 9.24): the near ring around the camera target
// is the sim's area of interest; `chunkChanged` rebuilds that chunk. Mock sim: neither.
const simStreamSync = simWorker
  ? new SimStreamSync(
      (i) => sim.send(stamper.stamp({ type: 'setInterest', ...i })),
      (cx, cy) => streaming.streamer.invalidate(cx, cy),
    )
  : undefined;
simWorker?.onEvents((events) => simStreamSync?.onEvents(events));
const playerInput = new PlayerInput(renderer.domElement, input, sim, stamper);
// Sneak toggle `C` (sim #205): the sim's `CharacterView.sneaking` is the state shown.
const sneak = new SneakToggle((on) => sim.send(stamper.stamp({ type: 'setSneak', on })));
const snapshots = new SnapshotBuffer();
// Physics / animation state per entity: the snapshot physics body + `physics` events (sim #62),
// derived on the client only for records without it (see anim/phys-adapter.ts). View only.
let weaponIndex: ReadonlyMap<string, WeaponInfo> = new Map();
const phys: PhysAdapter = new PhysAdapter({
  localPlayer: PLAYER_ID,
  knockbackOf: (attacker): number | undefined => {
    const w = gameState.get().combat?.weapon;
    return attacker === phys.localId && w ? weaponIndex.get(w)?.knockback : undefined;
  },
});
const weaponModels = new WeaponModels();
/** Visible equipment per character (view `characters[]`, full list on change). */
const characters = new Map<number, CharacterView>();
const crowd = new CrowdBuffer();
/** Animals (snapshot kind 3) in their own buffer; types by `variant` once the content loads. */
const animalBuffer = new CrowdBuffer(64, 64, (k) => k === SnapshotEntityKind.animal);
let animalViews: AnimalViews | undefined;
/** Animal type ids by snapshot `variant`, once the content loads. */
const animalTypes = Promise.resolve(simContent).then((content) =>
  animalTypeIds(content?.packs.flatMap((pk) => pk.files) ?? []),
);
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
  phys.pushSnapshot(tick, buf);
  crowd.push(buf, 1);
  animalBuffer.push(buf, 1);
  floorIntel.applySnapshot(buf, tick);
  crowdArrivedMs = performance.now();
});
const crowdView = new CrowdView(crowd, (next, prev) => {
  worldRoot.remove(prev);
  worldRoot.add(next);
});
worldRoot.add(crowdView.mesh);
const player = new PlayerView();
worldRoot.add(player.root);
// Cars (PLACEHOLDER boxes until models): vehicle snapshot block, interpolated per frame.
const vehicleView = new VehicleView(
  (variant) => {
    const types = hudContent.vehicleTypes;
    return types ? [...types.values()][variant] : undefined;
  },
  TICK_MS,
  // Realistic style: Designer's sedan (PBR) instead of the placeholder boxes.
  realStyle?.sedan(),
);
worldRoot.add(vehicleView.root);
/** Interpolated car poses of this frame (vehicle UI targets and anchors). */
let carPoses: SnapshotVehicle[] = [];
let carList: SnapshotVehicle[] = [];
simWorker?.onVehicles((list) => {
  carList = list;
  vehicleView.push(list, performance.now());
});
// Dev `?arrow=1`: facing arrow (body +X) on the ground and at chest height (pose previews).
if (import.meta.env.DEV && new URLSearchParams(location.search).get('arrow') === '1') {
  for (const [y, color] of [
    [0.03, 0xffd400],
    [1.4, 0xff3030],
  ] as const)
    player.root.add(
      new ArrowHelper(new Vector3(1, 0, 0), new Vector3(0, y, 0), 1.6, color, 0.25, 0.12),
    );
}

// Floors (deadzone-hud-v2-spec „Piętra (UI)”): building plans from the map, room discovery
// (`SimFloorIntel` from the sim, protocol 22, floors/floor-intel.ts); `?floorsDemo=1` = review data.
const floors = createFloors(world.source, structures.lookup, {
  demo: new URLSearchParams(location.search).get('floorsDemo') === '1',
  intel: floorIntel,
});
// HUD A (@deadzone/ui): DOM over the canvas, fed from the game state (spec deadzone-hud-spec §5).
const openingFeedback = new OpeningFeedback(PLAYER_ID);
let minimapGeo = minimapGeometry(world.source, follow?.range ?? world.range);
const hud = createHud({
  root: container,
  openingToast: (e) => openingFeedback.toast(e),
  bindings: () => settings.get().input.bindings,
  geometry: () => minimapGeo,
  pois: world.zones
    .filter((z) => z.role === 'extraction')
    .flatMap((z) =>
      z.rects.map((r) => ({ x: r.x + r.w / 2, z: r.y + r.h / 2, kind: 'objective' as const })),
    ),
  onInteract: interact,
  onAction: (id) => {
    if (id === 'sleep') sleep.toggleSleep();
    else if (id === 'watchTv') sleep.watchTv();
  },
  spots: () => spots,
  feedback: (e) => sleep.feedback(e),
  send: (cmd) => sim.send(stamper.stamp(cmd)),
  playerId: PLAYER_ID,
  tickMs: TICK_MS,
  // Phone: 4 radius levels (480 / 240 / 120 / 60 m, default 120 m); desktop: 0.6×–1.6×.
  minimapZoom: mobileView
    ? touchMinimapZoom(mobileView.get('minimapZoom'))
    : settings.get().view.minimapZoom,
  ...(touchMode.touch ? { minimapSteps: MINIMAP_TOUCH_STEPS, minimapLabel: radiusLabel } : {}),
  onMinimapZoom: (minimapZoom) =>
    mobileView
      ? mobileView.set('minimapZoom', minimapZoom)
      : settings.update((s) => ({ ...s, view: { ...s.view, minimapZoom } })),
  onQuickAccess: (id) => quickAccess(id),
});
// Sleep screen, sleep / wake / TV commands and the speed-up while asleep (mockup sleep.png).
const sendBody = (body: CommandBody) => {
  const cmd = stamper.stamp(body);
  sim.send(cmd);
  return cmd;
};
const sleep = createSleepController({
  root: container,
  playerId: PLAYER_ID,
  send: sendBody,
  // `client.setSpeed` sets the loop speed and sends `setTimeScale` (seq-exempt in the sim).
  setSpeed: sim.setSpeed ? (x) => sim.setSpeed?.(x) : undefined,
  state: () => gameState.get(),
  content: () => hudContent,
  keys: () => {
    const b = settings.get().input.bindings;
    return {
      wake: actionKey(b, 'pause'),
      speed: [actionKey(b, 'quickslot1'), actionKey(b, 'quickslot2'), actionKey(b, 'quickslot4')],
    };
  },
});
gameState.subscribe((next, prev) => sleep.observe(next, prev));
/** Beds, sofas and TVs of the map (sleep / TV buttons); filled once content is indexed. */
const objectsIn = (range: typeof world.range) =>
  consumerLevels(range.z).flatMap((z) => mapObjectsOf(world.source, { ...range, z }));
let mapObjectList = objectsIn(follow?.range ?? world.range);
// Room lights seen through windows at night (`view.litWindows`, protocol 34; the sim already
// leaves out curtained and boarded windows).
function updateRoomLit(): void {
  const keys = litWindowKeys(gameState.get().litWindows);
  streamedTown?.setRoomLit(keys);
  openings.setLitWindows?.(keys);
  townStructures?.setRoomLit(levelWindowKeys(keys, world.range.z));
  for (const l of upperTown) l.setRoomLit(levelWindowKeys(keys, l.z));
}
let spots: LeisureSpot[] = [];
input.on('sleep', () => sleep.toggleSleep());
input.on('watchTv', () => {
  if (!gameState.get().player.sleeping) sleep.watchTv();
});
// Zombie health (approved mockup): target bubble on Shift + LMB, bars over wounded (setting).
const zombieHp = new ZombieHpLayer(container, crowd);
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.shiftKey || !settings.get().interface.targetZombieHp) return;
  const ndc = clientToNdc(e.clientX, e.clientY, renderer.domElement.getBoundingClientRect());
  // Intersect at waist height: the cursor is on the body, not on the feet behind it.
  const hit = ndcToFloor(worldCamera, ndc.x, ndc.y, PICK_PLANE_Y);
  if (!hit) return;
  // The sim target card follows the pick: lock it, or drop the lock on empty ground.
  const id = zombieHp.pickAt(hit.x, hit.z);
  sendBody({ type: 'setTarget', id: id ?? null });
});
let hudContent: HudContentIndex = EMPTY_HUD_CONTENT;
if (boot.sim === 'worker') {
  void import('./content/base-pack.js').then((m) => {
    hudContent = buildHudContentIndex(m.baseFiles);
    // Furniture footprints (same flag as the sim: `worldSettings.furniture.footprint`, default
    // off = nothing changes, one tile each). Dev `?footprint=1` forces the render on.
    const fps = furnitureFootprintsFromFiles(m.baseFiles, import.meta.env.DEV && !!boot.footprint);
    if (fps.enabled) {
      streaming.mapObjects.setFootprints(fps);
      // Shelf props follow the model onto the footprint centre (Modules, `footprintCenter`).
      shelfFill.setFootprints(fps);
    }
    spots = leisureSpots(mapObjectList, hudContent);
    weaponIndex = buildWeaponIndex(m.baseFiles);
    hud.setContent(hudContent);
  });
}
// Baked item icons (tools/assets `icons`); vector icons until / unless they load.
void loadItemIcons();
// Inventory v3 (I / Esc, HUD v2 spec „Ekwipunek v3”): player panel (hands, pockets, bags) and the
// container panel with tabs; list / grid view and sorting kept in the UI settings.
const inventory = createInventoryV3({
  root: container,
  send: (cmd) => sleep.track(sendBody(cmd)),
  state: () => gameState.get(),
  content: () => hudContent,
  prefs: () => {
    const v = settings.get().view;
    return { view: v.inventoryView, sort: v.inventorySort, group: v.inventoryGroup };
  },
  setPrefs: (p) =>
    settings.update((s) => ({
      ...s,
      view: { ...s.view, inventoryView: p.view, inventorySort: p.sort, inventoryGroup: p.group },
    })),
  position: () => snapshots.sample(performance.now(), TICK_MS),
  // Trunk / glovebox tabs: searched once first (vehicle UI), others open directly.
  onSwitch: (id) => {
    if (vehicles.isVehicleContainer(id)) vehicles.openContainer(id);
    else sim.send(stamper.stamp({ type: 'openContainer', container: id }));
  },
  // Combine the hovered item: the crouch key (`C`) while the window is open (mockup combine.png).
  isCombineKey: (code) => settings.get().input.bindings.crouch.includes(code),
  combineKey: () => actionKey(settings.get().input.bindings, 'crouch'),
  toast: (text) => hud.toast(text),
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
  defer: (c) => furniture.handlesContainer(c),
});
// Furniture UI (spec „Meble i czynności (UI)”): RMB menu over furniture / doors / windows
// (`view.furnitureActions`, run with `useFurniture`), fridge window, watching panel, sleep choice.
// Beds come from the sim's list too (`sleep`, `sleep-until:*`, protocol 29): the sleep window
// picks the alarm and runs the matching `useFurniture` action.
// Multi-tile picking (`footprint` option) is left to the footprint render PR.
const furniturePlayer = () => {
  const p = snapshots.sample(performance.now(), TICK_MS);
  return p ? { x: p.x, y: p.y, z: p.z ?? 0 } : undefined;
};
const furniture = new FurnitureUi({
  root: container,
  source: new SimFurnitureSource({
    list: () => gameState.get().furniture,
    useFurniture: (furnitureId, actionId) => {
      sendBody({ type: 'useFurniture', furnitureId, actionId });
    },
  }),
  state: () => gameState.get(),
  content: () => hudContent,
  player: furniturePlayer,
  send: (cmd) => {
    sleep.track(sendBody(cmd));
  },
  keys: () => {
    const b = settings.get().input.bindings;
    return { run: actionKey(b, 'interact'), close: actionKey(b, 'pause') };
  },
  isRunKey: (code) => settings.get().input.bindings.interact.includes(code),
  surfaces: () => {
    const p = furniturePlayer();
    const nearby = new Set<SleepSurface>();
    if (!p) return { here: 'floor', nearby };
    for (const s of spots) {
      if (s.kind !== 'tv' && Math.hypot(s.tx + 0.5 - p.x, s.ty + 0.5 - p.y) <= SPOT_RADIUS_TILES)
        nearby.add(s.kind);
    }
    return { here: sleepSurfaceAt(spots, p.x, p.y), nearby };
  },
  tickMs: TICK_MS,
});
window.addEventListener(
  'keydown',
  (e) => {
    if (pause.simPaused || !furniture.open || !furniture.key(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  true,
);
/** Touch: the car menu when the tap lands on the targeted car (same menu as RMB). */
function openCarAtCursor(): boolean {
  if (!cursorPx) return false;
  const p = furniturePlayer();
  if (!p) return false;
  const ndc = clientToNdc(cursorPx.x, cursorPx.y, {
    left: 0,
    top: 0,
    width: gameRoot.clientWidth,
    height: gameRoot.clientHeight,
  });
  const hit = ndcToFloor(worldCamera, ndc.x, ndc.y, p.z * LEVEL_HEIGHT + 0.5);
  return !!hit && vehicles.pressSecondaryAt(hit.x, hit.z);
}
/** RMB click: the furniture menu for the object under the cursor; false = nothing there. */
function openFurnitureAtCursor(useDefault = false): boolean {
  if (!cursorPx) return false;
  const p = furniturePlayer();
  if (!p) return false;
  const w = gameRoot.clientWidth;
  const h = gameRoot.clientHeight;
  const ndc = clientToNdc(cursorPx.x, cursorPx.y, { left: 0, top: 0, width: w, height: h });
  // Furniture stands up to ~1 m: pick at knee height so the top of a bed / fridge counts.
  const hit = ndcToFloor(worldCamera, ndc.x, ndc.y, p.z * LEVEL_HEIGHT + 0.5);
  if (!hit) return false;
  return useDefault
    ? furniture.useDefaultAt(hit.x, hit.z, p.z, cursorPx.x, cursorPx.y)
    : furniture.openAt(hit.x, hit.z, p.z, cursorPx.x, cursorPx.y);
}
const workshop = createWorkshopWindow({
  root: container,
  send: (cmd) => sim.send(stamper.stamp(cmd)),
  state: () => gameState.get(),
  content: () => hudContent,
  position: () => snapshots.sample(performance.now(), TICK_MS),
});
const toggleInventory = () => {
  if (loot.open) loot.hide();
  workshop.close();
  inventory.toggle();
};
const toggleWorkshop = () => {
  if (loot.open) loot.hide();
  inventory.close();
  workshop.toggle();
};
input.on('inventory', toggleInventory);
// `C` combines the hovered item while the inventory is open; no sneak toggle then or in a car.
input.on('crouch', () => {
  if (inventory.open || vehicles.seated) return;
  sneak.toggle(performance.now());
});
input.on('crafting', toggleWorkshop);
/** Screens that do not exist yet: a short „wkrótce” toast (HUD v2 §3). */
const comingSoon = (id: QuickAccessId) => {
  const def = QUICK_ACCESS.find((q) => q.id === id);
  if (def && !QUICK_ACCESS_READY.has(id)) hud.toast(`${def.label} — wkrótce`);
};
// H: horn in the driver seat (vehicle UI [ZAŁ.]), else the character screen (soon).
input.on('character', () => {
  if (!vehicles.pressCharacter()) comingSoon('character');
});
input.on('skills', () => comingSoon('skills'));
input.on('journal', () => comingSoon('journal'));
/** Where the player is (big map, pause): nearest named place of a generated world, else the map. */
const locationName = (): string => {
  if (boot.map === 'test') return 'Mapa testowa';
  if (!genWorld) return boot.map;
  const p = bigMapPlayer();
  return nearestPlace(genWorld.source.info.places, p.x, p.y) ?? boot.map;
};
// Big map (M), HUD v2 spec §11. The world keeps running while it is open (no pause).
const bigMap = createBigMap({
  root: container,
  source: bigMapSource,
  toast: (text) => hud.toast(text),
  paper: () =>
    renderPaper(
      world.source,
      genWorld ? genStartRange(genWorld.source.bounds, bigMapPlayer(), 20) : world.range,
      (x, y) => structures.lookup.at(x, y, world.range.z) !== NO_BUILDING,
    ),
  // Far zooms: towns / villages over the fog, the map's edge, low-res terrain of every chunk seen.
  // Behind `?bigmap16=1` until Paweł OKs it; off = the classic big map.
  overview: !!boot.bigmap16,
  places: () => (boot.bigmap16 ? (genWorld?.source.info.places ?? []) : []),
  boundary: () => (boot.bigmap16 ? genWorld?.source.info.boundary : undefined),
  ...(boot.bigmap16 && {
    terrain: {
      palette: world.source.tilePalette,
      loaded: (cx, cy) => world.source.getChunk(cx, cy, world.range.z),
      // Discovered chunks that are not loaded (a save): generated maps ask the chunk worker.
      fetch: (cx, cy) =>
        genWorld
          ? genWorld.source.getChunk(cx, cy).then((c) => c?.levels.get(0))
          : Promise.resolve(world.source.getChunk(cx, cy, world.range.z)),
    },
  }),
  zoom: mobileView ? mobileView.get('bigMapZoom') : settings.get().view.bigMapZoom,
  layers: settings.get().view.bigMapLayers,
  onView: debounced(400, (bigMapZoom: number, bigMapLayers) => {
    mobileView?.set('bigMapZoom', bigMapZoom);
    settings.update((s) => ({
      ...s,
      view: { ...s.view, bigMapLayers, ...(mobileView ? {} : { bigMapZoom }) },
    }));
  }),
  floors,
  tick: () => stamper.tick,
  info: () => ({
    day: gameState.get().clock?.day,
    minuteOfDay: gameState.get().clock ? lightMinute : undefined,
    location: locationName(),
  }),
});
const bigMapPlayer = () => {
  const p = snapshots.sample(performance.now(), TICK_MS);
  return p ? { x: p.x, y: p.y, heading: p.facing } : { x: 0, y: 0, heading: 0 };
};
const toggleBigMap = () => {
  if (!bigMap.open) {
    if (loot.open) loot.hide();
    inventory.close();
    workshop.close();
  }
  bigMap.toggle(bigMapPlayer());
};
input.on('map', toggleBigMap);
/** Top bar quick access (HUD v2): same as the keys. */
function quickAccess(id: QuickAccessId): void {
  if (id === 'map') toggleBigMap();
  else if (id === 'inventory') toggleInventory();
  else if (id === 'crafting') toggleWorkshop();
  else if (id === 'menu') {
    handleEscape(escapeWindows, gameState.get().death !== undefined, () => pause.openMenu());
  } else comingSoon(id);
}
// Escape: an open window closes first; with none open, the pause menu (deadzone-menu-spec §6).
const escapeWindows: readonly Closable[] = [
  // Furniture menu / submenu / sleep choice / fridge window: the topmost closes first.
  furniture,
  {
    get open() {
      return bigMap.open;
    },
    close: () => bigMap.escape(),
  },
  // Sleeping: Esc wakes up first (sleep screen).
  {
    get open() {
      return sleep.sleeping;
    },
    close: () => sleep.wake(),
  },
  inventory,
  workshop,
  {
    get open() {
      return vehicles.open;
    },
    close: () => vehicles.close(),
  },
  {
    get open() {
      return loot.open;
    },
    close() {
      loot.hide();
      sim.send(stamper.stamp({ type: 'closeContainer' }));
    },
  },
  // Watching TV / a tape (panel „Przerwij Esc”): stops; XP of an unfinished tape is lost.
  {
    get open() {
      return furniture.watching;
    },
    close: () => furniture.stopWatching(),
  },
];
const pause = new PauseController({
  root: container,
  settings,
  player: playerSettings,
  openHudEditor: (draft, done) => hudLayout.openEditor(draft.hud, done),
  audio,
  trackTitle: MENU_TRACK.title,
  // Single-player: the menu stops the sim. Co-op will pass false (menu only, world runs on).
  pausesSim: true,
  host: {
    setSimPaused: (paused) => sim.setPaused(paused),
    setInputSuspended: (suspended) => input.setSuspended(suspended),
    info: () => {
      const gs = gameState.get();
      return {
        day: gs.clock?.day,
        minuteOfDay: gs.clock ? lightMinute : undefined,
        location: locationName(),
      };
    },
    lastSave: () => cloudPlay?.lastSave ?? saver?.lastSave,
    async saveAndExit() {
      if (simWorker && cloudPlay) {
        const save = await simWorker.save('exit');
        try {
          await cloudPlay.saveAndExit({
            tick: save.tick,
            day: save.day,
            minuteOfDay: lightMinute,
            reason: 'exit',
            data: save.buf,
          });
        } catch (e) {
          throw new SaveRefusedError(e instanceof Error ? e.message : String(e));
        }
        return;
      }
      // Permadeath: the character's single slot is overwritten, then back to the main menu.
      if (simWorker && saver) {
        const save = await simWorker.save('exit');
        const r = await saver.write({
          tick: save.tick,
          day: save.day,
          minuteOfDay: lightMinute,
          reason: 'exit',
          data: save.buf,
        });
        if (!r.ok) throw new SaveRefusedError(refusalText(r.reason));
      }
      window.location.assign(window.location.pathname);
    },
  },
});
input.on('pause', () => {
  handleEscape(escapeWindows, gameState.get().death !== undefined, () => pause.openMenu());
});
input.on('reload', () => {
  if (inventory.open) inventory.takeAll();
  // In the driver seat R = engine (hold: take the key); at a pump R = „Do pełna”.
  else if (vehicles.pressReload(performance.now())) return;
  else if (hud.firearm() && !gameState.get().death) sim.send(stamper.stamp({ type: 'reload' }));
});
const groundPiles = new GroundPiles();
worldRoot.add(groundPiles.root);
const { mapObjects } = streaming;
// Furniture pushed / pulled / turned (protocol 37): the model slides to its new tiles (the chunk
// is not rebuilt for it, sim-sync.ts), the mover's body steps with it.
simWorker?.onEvents((events) => {
  for (const e of events) {
    if (e.type !== 'furnitureMoved') continue;
    mapObjects.moveFurniture(e);
    if (e.playerId === PLAYER_ID) player.furnitureMoved();
  }
});
simWorker?.onView((view) => {
  if (view.furnitureMoves) mapObjects.setFurnitureMoves(view.furnitureMoves);
});
// Upper floors are not streamed (laid out whole, like `upperTown`): load their furniture too.
for (let z = world.range.z + 1; z <= world.range.z + upperTown.length; z++) {
  for (let cy = world.range.cy0; cy <= world.range.cy1; cy++) {
    for (let cx = world.range.cx0; cx <= world.range.cx1; cx++) {
      const chunk = world.source.getChunk(cx, cy, z);
      if (chunk) mapObjects.loadChunk(chunk);
    }
  }
}
const newShelfFill = (range: typeof world.range) =>
  new ShelfFill(
    world.source,
    range,
    (tx, ty, z, on) => mapObjects.setXray(tx, ty, z, on),
    consumerLevels(range.z),
  );
const shelfFill = newShelfFill(follow?.range ?? world.range);
worldRoot.add(shelfFill.root);
/** Generated maps: the consumers' window moved or its chunks streamed in → rebuild them. */
const refreshFollow = (): void => {
  const range = follow!.range;
  minimapGeo = minimapGeometry(world.source, range);
  sections.mark('follow:minimap');
  mapObjectList = objectsIn(range);
  spots = leisureSpots(mapObjectList, hudContent);
  pumpTiles = mapObjectList
    .filter((o) => o.contentId === FUEL_PUMP)
    .map((o) => ({ x: o.tx, y: o.ty, z: o.z }));
  sections.mark('follow:objects');
  if (town) lighting.lamps.setLamps(town.streetLampsOf(new town.MapTiles(world.source, 0), range));
  sections.mark('follow:lamps');
  // Same meshes / materials, new furniture list (no reallocation, no shader recompiles).
  shelfFill.setRange(range);
  sections.mark('follow:shelves');
};
// CC0 models (tools/assets → public/models); grey placeholders stay until/unless they load.
let zombieViews: InstancedZombies | undefined;
void ModelKit.create(renderer).then(async (kit) => {
  if (!kit) return;
  mapObjects.applyModels((id, h) => {
    const model = CONTAINER_MODELS[id];
    // Real-scale models (Designer, 1 m = 1 tile) keep their size; legacy ones are fit by height.
    return model ? kit.staticModel(model, isRealScale(id) ? undefined : h) : undefined;
  });
  groundPiles.pileModel = () => kit.staticModel(PILE_MODEL, 0.45) ?? new Group();
  // Shader warm-up: compile every furniture model's program now (parallel, off the frame) instead
  // of synchronously in the frame where the first such piece streams in.
  if (renderer.compileAsync) {
    const warm = new Group();
    worldRoot.add(warm);
    const w = mapObjects.prewarm(Object.keys(CONTAINER_MODELS), warm);
    void renderer
      .compileAsync(scene, camera)
      .catch(() => undefined)
      .finally(() => {
        w.dispose();
        worldRoot.remove(warm);
      });
  }
  try {
    const real = realStyle !== undefined;
    const p = await kit.character(characterModels(real ? 'real' : 'default').player, PLAYER_HEIGHT);
    if (real) lightReal(p.object);
    else brighten(p.object);
    addHulls(p.object);
    player.setModel(p.object, p.clips);
    // The creator's parts are Quaternius meshes: the realistic body keeps its baked outfit.
    if (!real)
      dressPlayer = (look) => {
        void import('./creator/player-look.js')
          .then((m) =>
            m.dressCharacter(p.object, look, (asset) =>
              kit.character(asset, PLAYER_HEIGHT).then((t) => t.object),
            ),
          )
          // Outlines for the creator parts too (idempotent).
          .then(() => addHulls(p.object))
          .catch((e: unknown) => console.warn('player look', e));
      };
    // Creator look right away; a loaded save brings its look in view.characterProfile.
    if (newCharacter) dressPlayer?.(newCharacter.look);
    else if (gameState.get().characterProfile) dressFromProfile();
  } catch (e) {
    console.warn('player model', e);
  }
  // CC0 animal models baked like the zombies (separate from them: a failure keeps the rest).
  void animalTypes
    .then(async (types) => {
      const templates = await loadAnimalTemplates(kit, types, 128);
      animalViews = new AnimalViews(animalBuffer, types, templates);
      worldRoot.add(animalViews.root);
    })
    .catch((e: unknown) => console.warn('animal models', e));
  const templates = await loadZombieTemplates(
    kit,
    characterModels(realStyle ? 'real' : 'default').zombies,
  );
  if (templates.length) {
    zombieViews = await InstancedZombies.create(templates, crowd);
    worldRoot.add(zombieViews.root);
    crowdView.mesh.visible = false;
  }
});
let dressPlayer: ((look: RenderLook) => void) | undefined;
let dressed = false;
function dressFromProfile(): void {
  const profile = gameState.get().characterProfile;
  if (dressed || !profile || !dressPlayer) return;
  dressed = true;
  const look = dressPlayer;
  void import('./creator/player-look.js').then((m) => look(m.lookOfProfile(profile)));
}
gameState.subscribe((next) => {
  if (!newCharacter && next.characterProfile) dressFromProfile();
});
// A character migrated from the old single save gets its name and portrait from the save.
if (session && !session.cloud && !session.character.appearance.look) {
  const id = session.character.id;
  let adopted = false;
  gameState.subscribe((next) => {
    const p = next.characterProfile;
    if (adopted || !p) return;
    adopted = true;
    void Promise.all([
      import('./creator/player-look.js'),
      import('./characters/portrait.js'),
      import('./characters/open-store.js'),
    ])
      .then(async ([look, portrait, open]) => {
        const l = look.lookOfProfile(p);
        const store = await open.characterStore();
        await store.adoptProfile(id, displayName(p.firstName, p.lastName), {
          portrait: portrait.portraitOf(l),
          look: l,
        });
      })
      .catch((e: unknown) => console.warn('Postać: profil z zapisu', e));
  });
}
let deathShown = false;
gameState.subscribe((next) => {
  if (!next.death || deathShown) return;
  deathShown = true;
  player.dead = true;
  inventory.close();
  loot.hide();
  showDeathScreen(container, next.death, boot.map === 'test' ? 'test' : boot.map);
  // Permadeath: the character becomes a tombstone and its save is deleted.
  const d = next.death;
  if (cloudPlay && simWorker) {
    const cloud = cloudPlay;
    void simWorker
      .save('manual')
      .then((save) =>
        cloud.die({ tick: save.tick, day: save.day, reason: 'death', data: save.buf }),
      )
      .then((ok) => {
        if (!ok) console.warn('Śmierć nie zapisana na koncie');
      })
      .catch((e: unknown) => console.error('Zapis śmierci na koncie nie powiódł się', e));
  }
  void saver
    ?.die(d.cause, d.daysSurvived ?? Math.max(0, d.day - 1))
    .then((r) => {
      if (!r.ok) console.warn(`Śmierć nie zapisana: ${refusalText(r.reason)}`);
    })
    .catch((e: unknown) => console.error('Zapis śmierci nie powiódł się', e));
});
/** Doors, gates and windows F can act on (`world/door-target.ts`); rebuilt when chunks stream. */
let targetEdgesRev = -1;
let targetEdgesList: DoorEdge[] = [];
const targetEdges = () => {
  const rev = openings.revision ?? 0;
  if (rev !== targetEdgesRev) {
    targetEdgesRev = rev;
    targetEdgesList = (['door', 'gate', 'window'] as const).flatMap((kind) =>
      openings.edges(kind).map((e) => ({ tx: e.tx, ty: e.ty, z: e.z, side: e.side, kind })),
    );
  }
  return targetEdgesList;
};
/** Nearest door / gate / window in reach of the player. */
const doorInReach = (x: number, y: number, z: number): DoorTarget | undefined =>
  nearestDoor(targetEdges(), (e) => openings.info(e.tx, e.ty, e.z, e.side), x, y, z);
/** Sim command on an opening edge (`toggleDoor`, `barricade`, `forceDoor` …). */
const openingCommand = (door: DoorTarget, cmd: OpeningCmd, item?: number): void => {
  if (cmd === 'coverWindow' && item === undefined) return;
  const at = { tx: door.tx, ty: door.ty, side: door.side };
  const c =
    cmd === 'coverWindow'
      ? stamper.stamp({ type: cmd, ...at, item: item! })
      : stamper.stamp({ type: cmd, ...at });
  openingFeedback.sent(c.seq, door);
  sim.send(c);
};
/** Interact key / button: open/close a door, search/open the nearest container, cancel, close. */
function interact(): void {
  if (inventory.open) {
    inventory.putAll();
    return;
  }
  const p = snapshots.sample(performance.now(), TICK_MS);
  if (!p) return;
  const intent = interactIntent(gameState.get(), p.x, p.y);
  // A door in reach (and no container panel / search to close first) opens or closes.
  const door =
    intent.type === 'open' || intent.type === 'none' ? doorInReach(p.x, p.y, p.z) : undefined;
  if (door && doorWins(door, intent.type === 'open')) {
    const main = openingPrimary(door);
    if (main) openingCommand(door, main.cmd);
    return;
  }
  if (intent.type === 'open')
    sim.send(stamper.stamp({ type: 'openContainer', container: intent.container }));
  else if (intent.type === 'close') sim.send(stamper.stamp({ type: 'closeContainer' }));
  else if (intent.type === 'cancel') sim.send(stamper.stamp({ type: 'cancelAction' }));
}
// F: tap opens, hold 3.5 s searches (HUD v2 §6); in windows / during actions the old press.
const projected = new Vector3();
/** Sim point (x, y, level z, height h m) → CSS px in the HUD root; undefined off screen. */
const interactProject = (
  x: number,
  y: number,
  z: number,
  h: number,
): { x: number; y: number } | undefined => {
  const w = simToWorld(x, y, z);
  projected.set(w.x, w.y + h, w.z).project(worldCamera);
  if (projected.z > 1 || Math.abs(projected.x) > 1.1 || Math.abs(projected.y) > 1.1) return;
  return {
    x: ((projected.x + 1) / 2) * container.clientWidth,
    y: ((1 - projected.y) / 2) * container.clientHeight,
  };
};
const interaction = new InteractController({
  state: () => gameState.get(),
  player: () => snapshots.sample(performance.now(), TICK_MS),
  door() {
    const p = snapshots.sample(performance.now(), TICK_MS);
    return p ? doorInReach(p.x, p.y, p.z) : undefined;
  },
  opening: openingCommand,
  coverItems: () =>
    coverChoices(gameState.get().inventory, (d) => !!hudContent.items.get(d)?.windowCover),
  toast: (text) => hud.toast(text),
  held: () => input.isDown('interact'),
  interrupted: () =>
    (['moveUp', 'moveDown', 'moveLeft', 'moveRight'] as const).some((a) => input.isDown(a)) ||
    input.isDown('primaryAction') ||
    input.isDown('secondaryAction'),
  windowOpen: () =>
    inventory.open || loot.open || workshop.open || furniture.open || !!gameState.get().death,
  legacy: interact,
  open: (id) => sim.send(stamper.stamp({ type: 'openContainer', container: id })),
  search: (t) => sim.send(stamper.stamp({ type: 'search', ...t })),
  cancel: () => sim.send(stamper.stamp({ type: 'cancelAction' })),
  project: (x, y, z, h) => interactProject(x, y, z, h),
  key: () => actionKey(settings.get().input.bindings, 'interact'),
  tickMs: TICK_MS,
});
// Vehicle UI first (car target, in a car, pump, its menu / windows), then doors and containers.
const vehicleHud = createVehicleHud();
container.append(vehicleHud.el);
// HUD editor layout (Ustawienia › Interfejs › EDYTUJ HUD): the car panel shares the weapon slot.
const hudLayout = installHudLayout({
  root: container,
  player: playerSettings,
  settings,
  targets: () => {
    const t = hud.layoutTargets();
    const dock = vehicleHud.el.querySelector<HTMLElement>('.dz-vh__dock');
    return dock ? { ...t, weapon: [...(t.weapon ?? []), dock] } : t;
  },
  setPreview: (on) => hud.setEditPreview(on),
});
/** Nearest door / non-vehicle storage the F key would use instead of a car (sim m). */
function otherTargetDist(): number {
  const p = snapshots.sample(performance.now(), TICK_MS);
  if (!p) return Infinity;
  let d = Infinity;
  const door = doorInReach(p.x, p.y, p.z);
  if (door) {
    const c = doorCentre(door);
    d = Math.hypot(c.x - p.x, c.y - p.y);
  }
  for (const c of gameState.get().nearby) {
    if (c.vehicle !== undefined || c.kind === 'ground') continue;
    d = Math.min(d, Math.hypot(c.x + 0.5 - p.x, c.y + 0.5 - p.y));
  }
  return d;
}
let pumpTiles = mapObjectList
  .filter((o) => o.contentId === FUEL_PUMP)
  .map((o) => ({ x: o.tx, y: o.ty, z: o.z }));
const vehicles = new VehicleController({
  state: () => gameState.get(),
  content: () => hudContent,
  player: () => snapshots.sample(performance.now(), TICK_MS),
  cars: () => carPoses,
  pumps: () => pumpTiles,
  send: (cmd) => sendBody(cmd),
  project: (x, y, z, h) => interactProject(x, y, z, h),
  isDown: (a) => input.isDown(a),
  keyOf: (a) => actionKey(settings.get().input.bindings, a),
  windowOpen: () =>
    inventory.open || loot.open || workshop.open || bigMap.open || !!gameState.get().death,
  otherTargetDist,
  showInventory: () => {
    if (!inventory.open) toggleInventory();
  },
  setTarget: (id) => vehicleView.setTarget(id),
  setSeated: (seated) => {
    container.dataset.vehicle = String(seated);
  },
  playerId: PLAYER_ID,
  tickMs: TICK_MS,
});
vehicleHud.onAction = (kind, id) => vehicles.action(kind, id);
window.addEventListener(
  'keydown',
  (e) => {
    if (pause.simPaused || !vehicles.key(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  true,
);
input.on('interact', () => {
  if (!vehicles.pressInteract(performance.now())) interaction.press(performance.now());
});
hud.onPromptMenu((i, kind) => {
  if (kind === 'pick') interaction.choose(i);
  else interaction.highlight(i);
});
// Melee: LMB attacks towards the aim point (weapon in hand_primary or fists), RMB shoves.
input.on('primaryAction', () => {
  if (inventory.open || gameState.get().death || vehicles.seated) return;
  // A click that only closed the furniture menu.
  if (furniture.swallowsClick()) return;
  rmb.attack();
  lastSwingMs = performance.now();
  const gun = hud.firearm();
  if (gun?.state === 'empty') hud.dryFire();
  sim.send(stamper.stamp({ type: 'attack' }));
  phys.noteLocalAction('attack');
});
// Vault (context key): over a standing fence / through an open or broken window in reach.
input.on('vault', () => {
  // In a car Space is the handbrake (`drive`).
  if (inventory.open || gameState.get().death || vehicles.seated) return;
  sim.send(stamper.stamp({ type: 'vault' }));
});
// RMB like PZ (input/rmb-gesture.ts): held = aim / ready (LMB attacks), a short click = the
// context action: the car menu at a car (vehicle UI [ZAŁ.]), otherwise a shove.
const rmb = new RmbGesture();
input.on('secondaryAction', () => {
  if (inventory.open || gameState.get().death || vehicles.seated) return;
  rmb.press(performance.now());
});
const onSecondaryRelease = (): void => {
  if (input.isDown('secondaryAction')) return;
  if (!rmb.release(performance.now())) return;
  if (inventory.open || gameState.get().death || vehicles.seated) return;
  if (vehicles.pressSecondary()) return;
  // Furniture / fixture under the cursor: its context menu instead of a shove.
  if (!furniture.open && openFurnitureAtCursor()) return;
  // Firearm in hand: RMB only aims with the reticle, no shove.
  if (hud.firearm()) return;
  lastSwingMs = performance.now();
  sim.send(stamper.stamp({ type: 'shove' }));
  phys.noteLocalAction('shove');
};
window.addEventListener('pointerup', onSecondaryRelease);
window.addEventListener('keyup', onSecondaryRelease);
window.addEventListener('blur', () => rmb.cancel());
// Aiming (PZ-like): the body faces the cursor while a mouse action is held and shortly after a
// swing; otherwise it turns towards the movement (player/locomotion.ts). Shift is sprint.
const AIM_HOLD_MS = 700;
let lastSwingMs = -Infinity;
const isAiming = (now: number): boolean =>
  input.isDown('primaryAction') ||
  input.isDown('secondaryAction') ||
  now - lastSwingMs < AIM_HOLD_MS;
// No browser context menu over the game (canvas and HUD); text fields keep theirs.
container.addEventListener('contextmenu', (e) => {
  if (!allowsNativeContextMenu(e.target)) e.preventDefault();
});
// Firearm aim reticle (spec §4): RMB held with a gun in hand, follows the cursor.
const gameRoot: HTMLElement = container;
const reticle = createAimReticle(gameRoot);
let cursorPx: { x: number; y: number } | undefined;
renderer.domElement.addEventListener('pointermove', (e) => {
  const r = container.getBoundingClientRect();
  cursorPx = { x: e.clientX - r.left, y: e.clientY - r.top };
});
renderer.domElement.addEventListener('pointerleave', () => (cursorPx = undefined));
// `use` (touch) = RMB short click: same release path as the mouse button.
input.onRelease('secondaryAction', onSecondaryRelease);
// Touch input layer (no visible UI yet: the touch HUD wires its stick and buttons to this API).
const touch = touchMode.touch
  ? new TouchControls({
      input,
      element: renderer.domElement,
      // Tap on an object = its default action; hold 450 ms = its context menu (RMB); the
      // ground does nothing.
      tap: (x, y) => {
        cursorPx = { x, y };
        if (furniture.open || inventory.open || vehicles.seated) return false;
        return openCarAtCursor() || openFurnitureAtCursor(true);
      },
      longPress: (x, y) => {
        cursorPx = { x, y };
        if (furniture.open || inventory.open || vehicles.seated) return false;
        return openCarAtCursor() || openFurnitureAtCursor();
      },
      aim: (p) => playerInput.setTouchAim(p),
      autoAim: () => {
        const p = snapshots.sample(performance.now(), TICK_MS);
        if (!p) return;
        const near = zombieHp.positionsNear(p.x, p.y, p.z, AUTO_AIM_RANGE);
        const t = autoAimTarget(p.x, p.y, p.facing, near);
        if (t) sim.send(stamper.stamp({ type: 'aim', x: t.x, y: t.z }));
      },
      zoom: (d) => {
        if (!container.dataset.modal) rig.zoomByWheel(d);
      },
      zoomStep: zoomLimits.step,
      debug: touchMode.debug,
      blocked: () => input.isSuspended || !!gameState.get().death,
    })
  : undefined;
if (touch) playerInput.setStick(() => touch.vector());
const touchHud = touch ? createTouchHud(container, touch) : undefined;
const touchZoom = touchHud
  ? createTouchZoomSlider(touchHud.el, zoomLimits, (z) => {
      if (!container.dataset.modal) rig.zoomTo(z);
    })
  : undefined;
if (touch && (import.meta.env.DEV || touchMode.debug))
  Object.assign(window, {
    __dzTouch: { controls: touch, mode: touchMode, landscapeLocked: () => landscapeLocked },
  });
const isGunAiming = (): boolean =>
  hud.firearm() !== undefined &&
  input.isDown('secondaryAction') &&
  !inventory.open &&
  !gameState.get().death;
function updateReticle(px: number, py: number, now: number): void {
  const gun = hud.firearm();
  const active = isGunAiming() && cursorPx !== undefined;
  gameRoot.classList.toggle('dz-aiming', active);
  if (!active || !gun || !cursorPx) {
    reticle.update({
      active: false,
      x: 0,
      y: 0,
      r: 0,
      warn: false,
      outOfRange: false,
      disabled: false,
      noiseRadius: 0,
      now,
    });
    return;
  }
  const w = gameRoot.clientWidth;
  const h = gameRoot.clientHeight;
  const ndc = clientToNdc(cursorPx.x, cursorPx.y, { left: 0, top: 0, width: w, height: h });
  const floor = ndcToFloor(worldCamera, ndc.x, ndc.y);
  const dist = floor ? Math.hypot(floor.x - px, floor.z - py) : 0;
  // Ortho camera: screen px per world unit (tile = 1 m).
  const pxPerM = (h * camera.zoom) / Math.max(1e-6, camera.top - camera.bottom);
  const spread = gameState.get().combat?.spread ?? 0;
  const hit = ndcToFloor(worldCamera, ndc.x, ndc.y, PICK_PLANE_Y);
  reticle.update({
    active: true,
    x: cursorPx.x,
    y: cursorPx.y,
    r: reticleRadius(spread, dist, pxPerM),
    warn: spread >= SPREAD_WARN,
    outOfRange: dist > gun.rangeTiles,
    disabled: gun.state === 'reloading' || gun.state === 'shell',
    distanceM: hit && zombieHp.zombieAt(hit.x, hit.z) ? dist : undefined,
    noiseRadius: gun.noiseRadius,
    now,
  });
}
QUICKSLOTS.forEach((action, i) =>
  input.on(action, () => {
    // Opening menu open: 1–n pick its entries instead of the quick slots.
    if (interaction.choose(i)) return;
    if (!sleep.speedKey(i)) hud.selectSlot(i);
  }),
);
input.on('toggleHints', () => hud.toggleHints(performance.now()));
// Tab: lock the next live zombie (nearest first, same floor, ≤ TARGET_MAX_TILES); the sim checks
// line of sight and answers with `view.target` (card) — the bubble follows the lock.
input.on('targetNext', () => {
  if (inventory.open || loot.open || workshop.open || bigMap.open || gameState.get().death) return;
  const p = snapshots.sample(performance.now(), TICK_MS);
  if (!p) return;
  const cur = gameState.get().target;
  const locked = cur?.source === 'lock' && cur.kind === 'zombie' ? cur.id : zombieHp.target;
  const id = nextTargetId(zombieHp.nearby(p.x, p.y, p.z, TARGET_MAX_TILES), locked);
  zombieHp.setTarget(id);
  sendBody({ type: 'setTarget', id: id ?? null });
});
// F1 & co. open browser help otherwise; Tab would move the focus out of the canvas.
window.addEventListener('keydown', (e) => {
  const b = settings.get().input.bindings;
  if (b.toggleHints.includes(e.code)) e.preventDefault();
  // Only in play (focus on the page / canvas): menus and forms keep Tab for their own focus.
  else if (
    b.targetNext.includes(e.code) &&
    (e.target === document.body || e.target === renderer.domElement)
  ) {
    e.preventDefault();
  }
});
// Noise circle (HUD v2 spec „Okrąg hałasu”): the own character's latest `playerNoise`, drawn on
// the ground in world space; filtered by Ustawienia › Interfejs › Pokazuj hałas.
const noise = new NoiseRingModel();
const noiseRing = new NoiseRingView(worldRoot);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
settings.subscribe((next) => noise.setDisplay(next.interface.noiseDisplay));
/** Drawing-buffer px per CSS px for the ring's stroke (pixel styles draw at a lower res). */
function noisePixelScale(): number {
  const style = settings.get().graphics.style;
  const h = Math.max(1, renderer.domElement.clientHeight);
  return isPixelStyle(style)
    ? Math.min(pixelRows(style), h * renderer.getPixelRatio()) / h
    : renderer.getPixelRatio();
}
gameState.subscribe((_next, _prev, action) => {
  if (action.type === 'events') {
    const display = settings.get().interface.noiseDisplay;
    for (const e of action.events) {
      if (e.type === 'playerNoise' && e.playerId === PLAYER_ID)
        noise.push(e, performance.now(), display);
    }
  }
  if (action.type === 'view' && action.view.openings) openings.setStates(action.view.openings);
  if (action.type === 'view' && action.view.litWindows) updateRoomLit();
  if (action.type === 'events') openings.applyEvents(action.events);
  if (action.type === 'view' && action.view.characters) {
    characters.clear();
    for (const c of action.view.characters) characters.set(c.stableId, c);
    sneak.setView(characters.get(phys.localId)?.sneaking === true);
  }
  if (action.type === 'events') {
    sleep.events(action.events);
    furniture.events(action.events);
    vehicles.events(action.events);
    hud.events(action.events);
    const p = snapshots.sample(performance.now(), TICK_MS);
    if (p)
      for (const c of eventCues(action.events, p.x, p.y, Math.random, PLAYER_ID))
        audio.play('sfx', c.id, c.volume);
    phys.pushEvents(action.events);
  }
});
// Lamps: test map placeholder list. The look follows the sim clock through the day cycle
// (night approved; dawn/day/dusk are placeholders in lighting/day-cycle-config.ts).
const lighting = createWorldLighting(
  scene,
  renderer,
  boot.map === 'test' ? createTestLamps() : (decor?.lamps ?? []),
  CAMERA_DISTANCE,
);
// Street lamps are world content; the sun / moon light and its shadow fit stay in render space.
worldRoot.add(lighting.lamps.root);
const dayCycle = new DayCycle(DAY_CYCLE);
if (realStyle) {
  realStyle.attach(scene, camera, lighting.sky.directional, window.devicePixelRatio);
  realStyle.setOrigin(floating.x, floating.z);
  floating.onShift((o) => realStyle.setOrigin(o.x, o.z));
  if (boot.pbrDemo) worldRoot.add(realStyle.demo(boot.pbrDemo.x, boot.pbrDemo.z));
  Object.assign(window, {
    __dzReal: {
      quality: realStyle.quality,
      budget: () => realStyle.budget(),
      /** Model instances on the map (blocks, houses, shelters, bushes). */
      map: () => realMap?.counts(),
    },
  });
}
/** One frame to the screen: the realistic pipeline when on, else the graphics style pass. */
const drawFrame = realStyle ? () => realStyle.render() : () => stylePass.render(scene, camera);
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
  realStyle?.setSize(width, height);
  // Sleep screen and notices live outside the HUD layer: same scale as the HUD (1920×1080 ref).
  container?.style.setProperty('--dz-sleep-scale', String(scaledUi(computeUiScale(width, height))));
}

new ResizeObserver(resize).observe(container);
resize();

let afterRender: ((r: WebGLRenderer) => void) | undefined;
let recordFrame: ((s: FrameSample, r: WebGLRenderer) => void) | undefined;
let perfFrame: ((r: WebGLRenderer, cpuMs: number) => void) | undefined;
/** CPU time per frame-loop section (`__dzFrame.sections()`, dev perf). */
const sections = new FrameSections();
if (boot.perf) {
  void import('./dev/perf-overlay.js').then(({ createPerfOverlay }) => {
    perfFrame = createPerfOverlay(document.body, {
      stream: () => streaming.streamer.stats(),
      caps: () => streaming.streamer.config,
      extra: () => {
        const p = snapshots.sample(performance.now(), TICK_MS);
        const at = p
          ? `player ${p.x.toFixed(1)}, ${p.y.toFixed(1)} (chunk ${Math.floor(p.x / CHUNK_SIZE)},${Math.floor(p.y / CHUNK_SIZE)})`
          : '';
        return `${at} · world ${streaming.streamer.source.id} v${streaming.streamer.source.version}`;
      },
    }).frame;
  });
}
if (boot.perf || boot.stress) {
  // Streaming test hooks (also in the public build, behind ?perf / ?stress).
  const mock = sim instanceof MockSimClient ? sim : undefined;
  Object.assign(window, {
    __dzFrame: { sections: () => sections.report(), reset: () => sections.reset() },
    __dzStream: {
      streamer: streaming.streamer,
      stats: () => streaming.streamer.stats(),
      teleport: (x: number, y: number) => mock?.teleport(x, y),
      walk: (dx: number, dy: number) => mock?.setAutoMove(dx || dy ? { dx, dy } : undefined),
    },
  });
}
if (import.meta.env.DEV) {
  // Dev / screenshots: window edges F can act on (find one to stand at with ?spawn=x,y).
  Object.assign(window, { __dzWindows: () => openings.edges('window') });
}
if (import.meta.env.DEV && !boot.perf) {
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
/** Dev `__dzAnim.furnitureAction(...)`: a `moveFurniture` action shown without the sim (frames). */
let devFurnitureAction:
  | {
      furniture: NonNullable<ActionView['furniture']>;
      k: number;
      seconds: number;
    }
  | undefined;
// Dev hook for headless screenshots / debugging of the animation layer (read-only access).
if (import.meta.env.DEV) {
  const devItemOf = (def: string): ItemId | undefined =>
    Object.values(gameState.get().inventory?.containers ?? {})
      .flatMap((c) => c.items ?? [])
      .find((i) => i.def === def)?.id;
  Object.assign(window, {
    __dzAnim: {
      phys,
      crowd,
      snapshots,
      camera,
      worldCamera,
      floating,
      rig,
      player,
      /** Pauses / resumes the sim worker (frames of a running action). */
      simPaused: (paused: boolean) => sim.setPaused(paused),
      /** Sends a stamped (debug) command, e.g. `{ type: 'debugSpawnZombie', x, y, count }`. */
      send: (body: CommandBody) => sim.send(stamper.stamp(body)),
      characters,
      /** Current game state (read-only). */
      state: () => gameState.get(),
      /** Feeds a fake own `playerNoise` to the noise circle (screenshots of the tiers). */
      noise: (e: Parameters<NoiseRingModel['push']>[0]) =>
        noise.push(e, performance.now(), settings.get().interface.noiseDisplay),
      get shelfFill() {
        return shelfFill;
      },
      mapObjects,
      /** Shows a furniture move action at progress `k` (undefined = none); view only. */
      furnitureAction: (a: typeof devFurnitureAction) => {
        devFurnitureAction = a;
      },
      animals: () => animalViews,
      groundPiles,
      /** Id of the first carried item of content `def`. */
      itemOf: (def: string): ItemId | undefined => devItemOf(def),
      /** Equips the first carried item of content `def` into `slot` (e.g. 'hand_primary'). */
      equip: (def: string, slot: EquipSlot): boolean => {
        const item = devItemOf(def);
        if (item !== undefined) sim.send(stamper.stamp({ type: 'equip', item, slot }));
        return item !== undefined;
      },
    },
  });
}

let lastFrameMs: number | undefined;
let cameraSnapped = false;
/** Occluder raycast cache (see the cutaway in the frame loop). */
let occCache: { key: string; at: number; set: ReadonlySet<number> } = {
  key: '',
  at: 0,
  set: new Set(),
};
// Dev `?hold=base:crowbar` / `?hold=chainsaw`: weapon drawn in the hand regardless of the
// inventory (grip previews, `weapons/grip.ts`). An optional `@grip` suffix overrides the grip.
const devQuery = import.meta.env.DEV ? new URLSearchParams(location.search) : undefined;
const devHoldParam = devQuery?.get('hold') ?? null;
/** Dev `?aim=1`: the player view keeps the aim pose (grip previews). */
const devAim = devQuery?.get('aim') === '1';
renderer.setAnimationLoop((time) => {
  const frameStart = performance.now();
  sections.start();
  const dt = lastFrameMs === undefined ? 0 : time - lastFrameMs;
  lastFrameMs = time;
  if (pause.simPaused) {
    // Paused: the world stands still behind the menu (no input, view or HUD updates).
    drawFrame();
    return;
  }
  // In a car WASD drive (`drive`, vehicle controller), no `move` / `aim`.
  if (!vehicles.seated) playerInput.update(time, rig.targetYaw, worldCamera);
  touchHud?.update({ sneaking: sneak.sneaking(time) });
  touchZoom?.update(rig.zoomTarget);
  const state = snapshots.sample(performance.now(), TICK_MS);
  const simTick = stamper.tick + Math.min(1, (performance.now() - crowdArrivedMs) / TICK_MS);
  if (state) {
    const loadout = weaponLoadout(characters.get(phys.localId), weaponIndex);
    const hand = devHoldWeapon(devHoldParam, weaponIndex) ?? loadout.hand;
    const back = loadout.back;
    player.aiming = devAim || isAiming(performance.now());
    const action = gameState.get().action;
    const span = action ? action.endTick - action.startTick : 0;
    const dev = devFurnitureAction;
    const f = action?.kind === 'moveFurniture' ? action.furniture : dev?.furniture;
    const k = dev
      ? dev.k
      : action && span > 0
        ? Math.min(1, Math.max(0, (simTick - action.startTick) / span))
        : 0;
    const seconds = dev ? dev.seconds : (span * TICK_MS) / 1000;
    player.setFurnitureAction(
      f ? { mode: f.mode, dirX: f.dirX, dirY: f.dirY, k, seconds } : undefined,
    );
    mapObjects.previewFurnitureMove(f, k);
    player.setWeapons(hand, back, weaponModels);
    player.apply(state, performance.now(), phys.get(phys.localId), simTick);
    // Seated: the body is inside the (placeholder) car.
    player.root.visible = gameState.get().seat === undefined;
    const goal = simToWorld(state.x, state.y, state.z);
    if (!cameraSnapped) rig.target.set(goal.x, goal.y, goal.z);
    else followStep(rig.target, goal, dt, FOLLOW_HALF_LIFE_MS);
    cameraSnapped = true;
    const { tx, ty } = tileOf(state.x, state.y);
    // Floor level of the body (fractional on stairs / while falling).
    const level = Math.floor(state.z + 1e-3);
    const building = structures.lookup.at(tx, ty, level);
    // Buildings between the camera and the player are cut down to its floor too (raycast);
    // recomputed on a new tile / floor / view and twice a second (chunks streaming in).
    const occKey = `${tx},${ty},${level},${building},${rig.targetYaw.toFixed(3)}`;
    const nowMs = performance.now();
    if (occKey !== occCache.key || nowMs - occCache.at > 500) {
      const at = (x: number, y: number, z: number) => structures.lookup.at(x, y, z);
      const occ = occludersOf(at, state.x, state.y, level, rig.targetYaw, building);
      const same = occ.size === occCache.set.size && [...occ].every((b) => occCache.set.has(b));
      occCache = { key: occKey, at: nowMs, set: same ? occCache.set : occ };
    }
    const cut = {
      building,
      tx,
      ty,
      side: cameraSide(rig.targetYaw),
      z: level,
      occluders: occCache.set,
    };
    structures.setCutaway(cut);
    for (const l of upperTown) l.setCutaway(cut);
    const fade = { px: state.x, py: state.y, yaw: rig.targetYaw, z: level };
    if ('setFade' in structures) structures.setFade(fade, dt);
    for (const l of upperTown) l.setFade(fade, dt);
    openings.setCutaway(cut);
    mapObjects.setCutaway(cut);
    realMap?.setCutaway(cut);
    const step = footsteps.update(state.x, state.y, building !== undefined, !player.dead);
    if (step) audio.play('sfx', step.id, step.volume);
  }
  sections.mark('player+cutaway');
  cameraInput.update(time);
  if (import.meta.env.DEV && boot.cam) {
    rig.target.set(boot.cam.x, 0, boot.cam.z);
    camera.zoom = VIEW_HEIGHT / boot.cam.viewHeight;
    camera.updateProjectionMatrix();
  }
  // Recentre the render origin on the camera target (whole chunks, > 1 km away), then place the
  // camera in render space and mirror it into world space.
  floating.update(rig.target.x, rig.target.z);
  rig.update(time);
  floating.syncWorldCamera(camera, worldCamera);
  sections.mark('camera');
  if (follow && state && follow.update(state, streaming.streamer.loaded.size, time))
    refreshFollow();
  // Stream around the player and the camera target (they differ while the camera catches up).
  streaming.streamer.update(
    state
      ? [
          { x: state.x, y: state.y },
          { x: rig.target.x, y: rig.target.z },
        ]
      : [startPoint],
  );
  sections.mark('stream');
  simStreamSync?.update({ x: rig.target.x, y: rig.target.z }, streaming.streamer.config);
  sections.mark('simsync');
  lightMinute = currentMinute(performance.now());
  const look = dayCycle.sample(lightMinute);
  // Sun direction from the shared `sunAt` (same as the sim's light level); moon at night.
  applySun(look, sunForClock(lightMinute, gameState.get().clock?.day ?? 1));
  lighting.applyCompiled(look, dayCycle.lampLevel(lightMinute));
  realStyle?.afterLighting();
  streamedTown?.setMinute(lightMinute);
  realMap?.update();
  if (townKit && townStructures) {
    townStructures.setMinute(lightMinute);
    for (const l of upperTown) l.setMinute(lightMinute);
    townKit.material.emissiveIntensity = town?.WINDOW_EMISSIVE_NIGHT
      ? town.WINDOW_EMISSIVE_NIGHT * dayCycle.lampLevel(lightMinute)
      : 0;
  }
  lighting.update(camera, rig.target.x, rig.target.z);
  sections.mark('light');
  const gs = gameState.get();
  const nowMs = performance.now();
  carPoses = carList.map((c) => vehicleView.poseOf(c.stableId, nowMs) ?? c);
  vehicleView.update(nowMs, dt);
  groundPiles.update(gs.groundPiles, gs.nearby, time);
  mapObjects.update(gs.nearby, time);
  if (!inventory.open) loot.update();
  workshop.update();
  sleep.frame(performance.now(), simTick);
  furniture.frame(performance.now(), simTick);
  shelfFill.update(gs.storages, gs.container?.id);
  openings.update(time / 1000);
  inventory.update();
  sections.mark('objects');
  if (state) {
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
      aiming: isGunAiming(),
      cameraZoom: rig.zoomTarget,
      sneaking: sneak.sneaking(performance.now()),
    });
    playerFloor = Math.floor(state.z + 1e-3);
    hud.setFloor(floors.frame({ x: state.x, y: state.y, z: playerFloor, tick: simTick }));
    const basePrompt = interaction.frame(performance.now(), simTick);
    const veh = vehicles.frame(performance.now(), simTick);
    vehicleHud.update(veh.hud);
    if (veh.hud.repair) container.dataset.modal = 'repair';
    else if (container.dataset.modal === 'repair') container.dataset.modal = '';
    // Seated: only the vehicle prompts (exit / hotwire ring), not the glovebox „Otwórz”; none
    // under the repair window.
    hud.setPrompt(
      veh.prompt ?? (vehicles.seated || veh.hud.repair ? { mode: 'hidden' } : basePrompt),
    );
    sections.mark('hud');
    bigMap.frame(performance.now(), { x: state.x, y: state.y, heading: state.facing });
    sections.mark('map');
    // 2 s after `C` switches sneaking on: the own step ring whatever „Pokazuj hałas” says.
    const nowMs = performance.now();
    if (sneak.revealing(nowMs) && sneak.sneaking(nowMs)) {
      const steps = characters.get(phys.localId)?.stepNoiseTiles ?? 0;
      noise.pushStep(steps, { x: state.x, y: state.y, z: state.z }, nowMs);
    }
    noiseRing.setPixelScale(noisePixelScale());
    noiseRing.update(
      noise.sample(performance.now(), reducedMotion.matches, {
        x: state.x,
        y: state.y,
        z: state.z,
      }),
    );
    updateReticle(state.x, state.y, performance.now());
  }
  const t0 = performance.now();
  const alpha = tickAlpha(t0, crowdArrivedMs, TICK_MS);
  if (zombieViews) {
    zombieViews.update(alpha, t0 / 1000, worldCamera, rig.target.x, rig.target.z, phys, simTick);
  } else crowdView.update(alpha);
  animalViews?.update(alpha, t0 / 1000, worldCamera, rig.target.x, rig.target.z);
  const ui = settings.get().interface;
  zombieHp.update(alpha, worldCamera, container.clientWidth, container.clientHeight, {
    showWounded: ui.showZombieHp,
    targeting: ui.targetZombieHp,
  });
  sections.mark('misc');
  const t1 = performance.now();
  drawFrame();
  sections.mark('render');
  frameSample.updateMs = t1 - t0;
  frameSample.renderMs = performance.now() - t1;
  recordFrame?.(frameSample, renderer);
  afterRender?.(renderer);
  perfFrame?.(renderer, performance.now() - frameStart);
  sections.mark('overlay');
  sections.end();
});

// Dev only: switch / freeze the graphics style for screenshots and measurements.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __dzStyle: {
      set: (style: GraphicsStyle) =>
        settings.update((s) => ({ ...s, graphics: { ...s.graphics, style } })),
      frame: frameSample,
      pass: stylePass,
      calls: () => renderer.info.render.calls,
      scene,
      /** Stops the loop and draws the current frame once in `style` (same frame per style). */
      still: (style: GraphicsStyle) => {
        renderer.setAnimationLoop(null);
        stylePass.setStyle(style);
        stylePass.render(scene, camera);
      },
    },
  });
}
