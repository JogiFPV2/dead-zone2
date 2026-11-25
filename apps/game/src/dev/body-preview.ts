import {
  AnimationMixer,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  WebGLRenderer,
  type AnimationClip,
  type Object3D,
} from 'three';
import { findClip } from '../models/character-rig.js';
import { ModelKit, ZOMBIE_MODELS } from '../models/model-kit.js';
import { rebuildCharacter, SURVIVOR, ZOMBIE_BODIES } from '../models/painted-body/body.js';
import { PLAYER_HEIGHT } from '../player/player-view.js';
import { addHulls, setHullSize } from '../render/style-materials.js';

/**
 * Dev sheet of the new painted bodies (`/body-preview.html?clip=Walk&t=0.3&turn=0`): survivor
 * and the zombie bodies in a row, front and back, one clip frame. For acceptance screenshots.
 */
const q = new URLSearchParams(location.search);
const W = 1600;
const H = 900;
const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new Scene();
scene.background = new Color('#cfc8b8');
scene.add(new HemisphereLight('#fff6e6', '#5a5a66', 1.4));
const sun = new DirectionalLight('#fff1d8', 2.2);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 4, bottom: -4 });
scene.add(sun);
const ground = new Mesh(new PlaneGeometry(40, 20), new ShadowMaterial({ opacity: 0.25 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const zoom = Number(q.get('zoom') ?? 1);
const cam = new OrthographicCamera(
  -W / 260 / zoom,
  W / 260 / zoom,
  H / 260 / zoom,
  -H / 260 / zoom,
  0.1,
  100,
);
const iso = q.get('iso') === '1';
cam.position.set(0, iso ? 9 : 1.6, 10);
cam.lookAt(0, iso ? 0.6 : 0.95, 0);
setHullSize(2, W, H);

const kit = await ModelKit.create(renderer);
if (!kit) throw new Error('no models');
const specs = [SURVIVOR, ...ZOMBIE_BODIES];
const clipName = q.get('clip') ?? 'Idle';
const t = Number(q.get('t') ?? 0.3);
const turn = Number(q.get('turn') ?? 0);
const mixers: AnimationMixer[] = [];
const place = (o: Object3D, clips: AnimationClip[], x: number, yaw: number) => {
  o.position.x = x;
  o.rotation.y = yaw;
  scene.add(o);
  const mixer = new AnimationMixer(o);
  const clip = findClip(clips, clipName);
  if (clip) {
    const a = mixer.clipAction(clip);
    a.play();
    mixer.setTime(t * clip.duration);
  }
  mixers.push(mixer);
};
const gap = Number(q.get('gap') ?? 1);
const backs = q.get('back') === '1' ? [1] : q.get('back') === 'both' ? [0, 1] : [0];
for (const [i, spec] of specs.entries()) {
  for (const back of backs) {
    const { object, clips } = await kit.character(ZOMBIE_MODELS[0]!, PLAYER_HEIGHT);
    rebuildCharacter(object, spec);
    object.traverse((m) => {
      if ((m as Mesh).isMesh) (m as Mesh).castShadow = true;
    });
    addHulls(object);
    const x =
      (i - (specs.length - 1) / 2) * gap * (backs.length > 1 ? 1.6 : 1) +
      (backs.length > 1 ? (back ? 0.36 : -0.36) : 0);
    place(object, clips, x, (back ? Math.PI : 0) + turn);
  }
}
renderer.render(scene, cam);
(window as unknown as { __ready: boolean }).__ready = true;
