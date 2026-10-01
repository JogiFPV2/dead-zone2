import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  CircleGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  ShadowMaterial,
  WebGLRenderer,
  type AnimationClip,
  type Object3D,
} from 'three';
import { createAssetLoader, fitted } from '../models/model-kit.js';
import { PLAYER_HEIGHT } from '../player/player-view.js';
import {
  MODEL_ASSET,
  type MeshRef,
  type ModelId,
  type PartColors,
  type RenderLook,
} from './appearance-map.js';
import { CharacterAssembly } from './character-builder.js';
import { orbitCamera, partFrame } from './preview-math.js';

/** Live 3D preview of the creator (render reference: deadzone-icons/render/char.html). */
export interface CreatorPreview {
  readonly canvas: HTMLCanvasElement;
  setLook(look: RenderLook): void;
  /** Turns the character (radians, + = counter-clockwise seen from above). */
  rotate(delta: number): void;
  /** Zoom factor 1 (full body) .. 0.55 (closer). */
  zoom(delta: number): void;
  /** CSS size of the canvas in device px. */
  resize(width: number, height: number): void;
  /** PNG data URL of one part on its own (tiles of the look step). */
  thumbnail(ref: MeshRef, colors: PartColors, skin: string): string;
  dispose(): void;
}

const IDLE_T = 0.4;
const THUMB = 192;
const MODELS = Object.keys(MODEL_ASSET) as ModelId[];

function lights(scene: Scene, shadows: boolean): void {
  const key = new DirectionalLight(0xfff0d8, 2.6);
  key.position.set(-3, 6, 5);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.5, bottom: -0.5 });
    key.shadow.bias = -0.0005;
  }
  const fill = new DirectionalLight(0x9fb4c8, 0.8);
  fill.position.set(5, 2, 3);
  const rim = new DirectionalLight(0xffc98a, 2.4);
  rim.position.set(1, 4, -6);
  scene.add(key, fill, rim, new HemisphereLight(0xc3ccd2, 0x262b24, 0.6));
}

function makeRenderer(canvas?: HTMLCanvasElement, preserve = false): WebGLRenderer {
  const r = new WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: preserve,
    ...(canvas ? { canvas } : {}),
  });
  r.setClearColor(0, 0);
  r.toneMapping = ACESFilmicToneMapping;
  r.toneMappingExposure = 1.15;
  r.outputColorSpace = SRGBColorSpace;
  return r;
}

function idle(root: Object3D, clips: readonly AnimationClip[]): AnimationMixer {
  const mixer = new AnimationMixer(root);
  const clip = clips.find((c) => c.name.endsWith('|Idle'));
  if (clip) mixer.clipAction(clip).play();
  mixer.update(IDLE_T);
  return mixer;
}

export async function createCreatorPreview(): Promise<CreatorPreview> {
  const renderer = makeRenderer();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.className = 'dzc-canvas';
  // Shared KTX2Loader (menu / game / creator: one transcoder, no 'multiple loaders' warning).
  const loader = createAssetLoader(renderer);
  await loader.loadManifest();
  const loaded = await Promise.all(MODELS.map((id) => loader.loadAnimated(MODEL_ASSET[id])));
  const templates = Object.fromEntries(MODELS.map((id, i) => [id, loaded[i]!.object])) as Record<
    ModelId,
    Object3D
  >;
  const clips = loaded[0]!.clips;

  // Main character: own clone of the casual model, parts swapped per look.
  const base = await loader.loadAnimated(MODEL_ASSET.casual);
  const scene = new Scene();
  lights(scene, true);
  const wrap = fitted(base.object, PLAYER_HEIGHT);
  const assembly = new CharacterAssembly(base.object, templates);
  scene.add(wrap);
  const floor = new Mesh(new CircleGeometry(0.9, 48), new ShadowMaterial({ opacity: 0.45 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  floor.receiveShadow = true;
  scene.add(floor);
  const mixer = idle(base.object, clips);
  const camera = new PerspectiveCamera(22, 1, 0.1, 100);
  let yaw = 0;
  let zoomK = 1;

  // Thumbnails: a small second renderer and one posed copy per model, other parts hidden.
  const thumbs = makeRenderer(undefined, true);
  thumbs.setPixelRatio(1);
  thumbs.setSize(THUMB, THUMB);
  const thumbScene = new Scene();
  lights(thumbScene, false);
  const thumbCam = new PerspectiveCamera(22, 1, 0.05, 100);
  const thumbRig = await loader.loadAnimated(MODEL_ASSET.casual);
  const thumbWrap = fitted(thumbRig.object, PLAYER_HEIGHT);
  const thumbAssembly = new CharacterAssembly(thumbRig.object, templates);
  idle(thumbRig.object, clips);
  thumbScene.add(thumbWrap);
  const box = new Box3();

  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    mixer.update(Math.min(0.1, (now - last) / 1000));
    last = now;
    wrap.rotation.y = yaw;
    orbitCamera(camera, PLAYER_HEIGHT, zoomK);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    canvas: renderer.domElement,
    setLook: (look) => assembly.setLook(look),
    rotate(d) {
      yaw += d;
    },
    zoom(d) {
      zoomK = Math.min(1, Math.max(0.55, zoomK + d));
    },
    resize(w, h) {
      renderer.setSize(Math.max(1, w), Math.max(1, h), false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    thumbnail(ref, colors, skin) {
      thumbAssembly.setLook({ skin, parts: [{ ref, colors }] });
      thumbWrap.updateMatrixWorld(true);
      box.setFromObject(thumbWrap, true);
      partFrame(thumbCam, box, ref.mesh);
      thumbs.render(thumbScene, thumbCam);
      return thumbs.domElement.toDataURL('image/png');
    },
    dispose() {
      cancelAnimationFrame(raf);
      assembly.dispose();
      thumbAssembly.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      loader.dispose();
      for (const r of [renderer, thumbs]) {
        r.dispose();
        r.forceContextLoss();
      }
      renderer.domElement.remove();
    },
  };
}
