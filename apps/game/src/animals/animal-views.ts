import {
  Box3,
  Color,
  Euler,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Sphere,
  Vector3,
  type AnimationClip,
  type Camera,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { SnapshotAnim } from '@deadzone/protocol';
import { CROWD_SAMPLE_STRIDE, type CrowdBuffer } from '../crowd/crowd-buffer.js';
import { findClip } from '../models/character-rig.js';
import {
  BAKE_FPS,
  bakeSkinned,
  type BakedSkin,
  type ClipRange,
} from '../models/instanced-zombies.js';
import { CHARACTER_EMISSIVE } from '../models/zombie-views.js';
import { hullsEnabled, registerHull } from '../render/style-materials.js';
import { PIXEL_PALETTE } from '../render/style-shader.js';
import { LEVEL_HEIGHT } from '../world/instances.js';
import {
  ANIMAL_CLIPS,
  speciesOf,
  variantOf,
  type AnimalClip,
  type AnimalModelRef,
  type AnimalSpecies,
} from './animal-species.js';

/** Bird flight: climb rate (m/s) and ceiling (m) after it takes off. */
const FLY_CLIMB = 2.2;
const FLY_MAX = 4;
/** Idle grazers eat for EAT_SHARE of every EAT_PERIOD seconds (per-animal offset). */
const EAT_PERIOD = 12;
const EAT_SHARE = 0.5;
/** Moving faster than this (m/s) plays a locomotion clip even if the sim says idle. */
const MOVING = 0.15;
/** Animals farther than this from the view centre use the decimated LOD. */
const LOD_DISTANCE = 14;
/** Culling sphere around an animal (m). */
const CULL_RADIUS = 1.4;
/** How far the palette pulls model colours that have no explicit colour (0..1). */
const PALETTE_PULL = 0.5;

/** One baked look (species model variant) and the clips it really has. */
export interface AnimalTemplate {
  skin: BakedSkin<AnimalClip>;
  has: ReadonlySet<AnimalClip>;
}

/** Per-animal view state. */
export interface AnimalTrack {
  anim: number;
  /** Seconds since `anim` last changed (death, take-off). */
  since: number;
  /** Locomotion clip time (s), advanced at the speed-matched rate. */
  loopTime: number;
  /** Per-animal time offset (eating out of sync). */
  offset: number;
}

/** What one animal shows this frame: a clip time plus a body offset (lift m, roll / pitch rad). */
export interface AnimalFrame {
  clip: AnimalClip;
  time: number;
  loop: boolean;
  lift: number;
  roll: number;
  pitch: number;
}

/**
 * Clip and body offset for an animal state (snapshot anim 0 idle / eat, 1 walk, 2 / 5 run or
 * fly, 4 dead). Missing clips fall back: no death clip → idle pose rolled onto its side, no run
 * → walk (played faster), no eat → idle; birds walk by hopping on the idle clip.
 */
export function animalPose(
  s: AnimalSpecies,
  has: ReadonlySet<AnimalClip>,
  anim: number,
  speed: number,
  tr: AnimalTrack,
  t: number,
  out: AnimalFrame = { clip: 'idle', time: 0, loop: true, lift: 0, roll: 0, pitch: 0 },
): AnimalFrame {
  out.lift = out.roll = out.pitch = 0;
  out.loop = true;
  out.time = tr.loopTime;
  if (anim === SnapshotAnim.dead) {
    out.loop = false;
    if (has.has('death')) {
      out.clip = 'death';
      out.time = tr.since;
    } else {
      out.clip = 'idle';
      out.time = 0;
      out.roll = Math.min(1, tr.since * 3) * (Math.PI / 2);
    }
    return out;
  }
  if (anim === SnapshotAnim.flee || anim === SnapshotAnim.run) {
    if (s.flies) {
      out.clip = has.has('fly') ? 'fly' : 'idle';
      out.lift = Math.min(FLY_MAX, tr.since * FLY_CLIMB);
      out.pitch = 0.25;
    } else out.clip = has.has('run') ? 'run' : 'walk';
    return out;
  }
  if (anim === SnapshotAnim.walk || speed > MOVING) {
    if (has.has('walk')) out.clip = 'walk';
    else {
      out.clip = 'idle';
      out.lift = Math.abs(Math.sin(t * 14)) * 0.05;
    }
    return out;
  }
  const u = (((t + tr.offset) % EAT_PERIOD) + EAT_PERIOD) % EAT_PERIOD;
  if (has.has('eat') && u < EAT_PERIOD * EAT_SHARE) {
    out.clip = 'eat';
    out.time = u;
  } else out.clip = 'idle';
  return out;
}

/** Playback rate of the locomotion clip: follows the ground speed (feet don't slide). */
export function loopRate(
  s: AnimalSpecies,
  has: ReadonlySet<AnimalClip>,
  f: AnimalFrame,
  speed: number,
): number {
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  // Without a run clip (cats) the walk sped up further reads as a trot.
  if (f.clip === 'walk') return clamp(speed / s.walkRef, 0.5, has.has('run') ? 2 : 3);
  if (f.clip === 'run') return clamp(speed / s.runRef, 0.6, 1.6);
  return 1;
}

/** Bake texture row of a frame: loops wrap, one-shots clamp. */
export function frameRow(r: ClipRange, f: AnimalFrame): number {
  const k = Math.floor(f.time * BAKE_FPS);
  const last = r.frames - 1;
  return (
    r.start + (f.loop ? ((k % r.frames) + r.frames) % r.frames : Math.min(Math.max(k, 0), last))
  );
}

/** OKLab of a linear RGB colour. */
function oklab(c: Color): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  const m = Math.cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  const s = Math.cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const PALETTE = PIXEL_PALETTE.map((h) => {
  const c = new Color(h);
  return { c, lab: oklab(c) };
});

/** `c` pulled `amount` of the way to its nearest game-palette colour (OKLab), in place. */
export function towardPalette(c: Color, amount = PALETTE_PULL): Color {
  const [l, a, b] = oklab(c);
  let best = PALETTE[0]!;
  let bd = Infinity;
  for (const p of PALETTE) {
    const d = (p.lab[0] - l) ** 2 + (p.lab[1] - a) ** 2 + (p.lab[2] - b) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return c.lerp(best.c, amount);
}

/**
 * Colours (species table, else pulled to the palette), self-light like the other characters,
 * and the fit: nose to +X, `length` m long, feet at y = 0, centred. Returns the bake root.
 */
export function prepareAnimal(object: Object3D, s: AnimalSpecies, ref: AnimalModelRef): Group {
  object.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]) as MeshStandardMaterial[];
    const next = mats.map((m) => {
      const c = m.clone();
      const key = Object.keys(s.colours ?? {}).find((k) => c.name.startsWith(k));
      if (key !== undefined) c.color.setHex(s.colours![key]!);
      else towardPalette(c.color);
      // Matte like the rest of the low-poly set (some packs ship glossy materials).
      c.roughness = 1;
      c.metalness = 0;
      c.emissive.copy(c.color);
      c.emissiveIntensity = CHARACTER_EMISSIVE;
      return c;
    });
    o.material = Array.isArray(o.material) ? next : next[0]!;
    o.castShadow = true;
    o.frustumCulled = false;
  });
  const turn = new Group();
  turn.rotation.y = ref.yaw;
  turn.add(object);
  turn.updateMatrixWorld(true);
  const box = new Box3().setFromObject(turn);
  const size = box.getSize(new Vector3());
  const k = size.x > 0 ? ref.length / size.x : 1;
  object.scale.multiplyScalar(k);
  turn.updateMatrixWorld(true);
  box.setFromObject(turn);
  const c = box.getCenter(new Vector3());
  turn.position.set(-c.x, -box.min.y, -c.z);
  const root = new Group();
  root.add(turn);
  return root;
}

/** Bakes one prepared animal model: clip slots by the species' clip names. */
export function bakeAnimal(
  root: Group,
  clips: readonly AnimationClip[],
  s: AnimalSpecies,
  capacity: number,
): AnimalTemplate {
  const picked = ANIMAL_CLIPS.map((c) => {
    const name = s.clips[c];
    return [c, name ? findClip(clips, name) : undefined] as const;
  });
  const has = new Set(picked.filter(([, clip]) => clip).map(([c]) => c));
  return { skin: bakeSkinned(root, picked, capacity, 0, 'animal'), has };
}

/** Raw animated model source (`ModelKit.animated`). */
export interface AnimalModelSource {
  animated(id: string): Promise<{ object: Object3D; clips: AnimationClip[] }>;
}

/** Loads and bakes every model of `typeIds` (each id once); a failed model is skipped. */
export async function loadAnimalTemplates(
  kit: AnimalModelSource,
  typeIds: readonly string[],
  capacity: number,
): Promise<Map<string, AnimalTemplate>> {
  await MeshoptSimplifier.ready;
  const out = new Map<string, AnimalTemplate>();
  for (const typeId of typeIds) {
    const s = speciesOf(typeId);
    if (!s) continue;
    for (const ref of s.models) {
      if (out.has(ref.id)) continue;
      try {
        const { object, clips } = await kit.animated(ref.id);
        out.set(ref.id, bakeAnimal(prepareAnimal(object, s, ref), clips, s, capacity));
      } catch (e) {
        console.warn(`animal model ${ref.id}`, e);
      }
    }
  }
  return out;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _e = new Euler();

/**
 * Animals (snapshot kind 3, `variant` = type index) as GPU-instanced skinned CC0 models:
 * clips baked into bone textures like the zombies, one InstancedMesh per model part (draw calls
 * independent of the animal count). Clip per state and speed-matched playback: `animalPose`.
 */
export class AnimalViews {
  readonly root = new Group();
  private readonly tracks = new Map<number, AnimalTrack>();
  private readonly counts = new Map<string, number>();
  private sample = new Float32Array(64 * CROWD_SAMPLE_STRIDE);
  private lastS: number | undefined;
  private readonly frame: AnimalFrame = {
    clip: 'idle',
    time: 0,
    loop: true,
    lift: 0,
    roll: 0,
    pitch: 0,
  };
  private readonly frustum = new Frustum();
  private readonly sphere = new Sphere(new Vector3(), CULL_RADIUS);
  private readonly vp = new Matrix4();

  /** `typeIds`: content ids by snapshot `variant`; `templates` by model asset id. */
  constructor(
    private readonly buffer: CrowdBuffer,
    private readonly typeIds: readonly string[],
    private readonly templates: ReadonlyMap<string, AnimalTemplate>,
    private readonly capacity = 128,
  ) {
    this.root.name = 'animals';
    for (const [id, t] of templates)
      for (const p of [...t.skin.parts, ...t.skin.far, ...t.skin.shadow]) {
        p.mesh.name = `${id}`;
        this.root.add(p.mesh);
        if (p.hull) {
          this.root.add(p.hull);
          registerHull(p.hull);
        }
      }
  }

  /** Instances drawn per model id in the last update (tests, debug). */
  drawn(): Record<string, number> {
    return Object.fromEntries([...this.counts].filter(([, n]) => n > 0));
  }

  /** Model asset id drawn for an animal of `typeId` with stable id `id`. */
  modelOf(typeId: string, id: number): string | undefined {
    const s = speciesOf(typeId);
    if (!s) return undefined;
    const ref = s.models[variantOf(s, id)] ?? s.models[0];
    if (ref && this.templates.has(ref.id)) return ref.id;
    return s.models.find((m) => this.templates.has(m.id))?.id;
  }

  update(alpha: number, nowS: number, camera?: Camera, cx = 0, cz = 0): void {
    const dt = this.lastS === undefined ? 0 : Math.min(0.1, Math.max(0, nowS - this.lastS));
    this.lastS = nowS;
    const b = this.buffer;
    if (this.sample.length < b.capacity * CROWD_SAMPLE_STRIDE)
      this.sample = new Float32Array(b.capacity * CROWD_SAMPLE_STRIDE);
    const n = b.sample(alpha, this.sample);
    if (camera) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(
        this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
    }
    const near = new Map<string, number>();
    const far = new Map<string, number>();
    const live = new Set<number>();
    const lod2 = LOD_DISTANCE * LOD_DISTANCE;
    for (let i = 0; i < n; i++) {
      const id = b.idAt(i);
      live.add(id);
      const anim = b.anim[i] ?? 0;
      const speed = b.speed[i] ?? 0;
      const typeId = this.typeIds[b.variant[i] ?? 0] ?? 'unknown';
      let tr = this.tracks.get(id);
      if (!tr) {
        tr = { anim, since: 0, loopTime: 0, offset: ((id * 0.6180339) % 1) * EAT_PERIOD };
        this.tracks.set(id, tr);
      }
      if (tr.anim !== anim) {
        tr.anim = anim;
        tr.since = 0;
      } else tr.since += dt;
      const modelId = this.modelOf(typeId, id);
      const t = modelId ? this.templates.get(modelId) : undefined;
      if (!modelId || !t) continue;
      const s = speciesOf(typeId)!;
      const f = animalPose(s, t.has, anim, speed, tr, nowS, this.frame);
      tr.loopTime += dt * loopRate(s, t.has, f, speed);
      const o = i * CROWD_SAMPLE_STRIDE;
      const x = this.sample[o] ?? 0;
      const z = this.sample[o + 1] ?? 0;
      const y = (this.sample[o + 2] ?? 0) * LEVEL_HEIGHT + f.lift;
      if (camera) {
        this.sphere.center.set(x, y + 0.4, z);
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
      }
      const lod = (x - cx) ** 2 + (z - cz) ** 2 > lod2 && t.skin.far.length > 0;
      const counter = lod ? far : near;
      const k = counter.get(modelId) ?? 0;
      if (k >= this.capacity) continue;
      counter.set(modelId, k + 1);
      _e.set(f.roll, -(this.sample[o + 3] ?? 0), f.pitch, 'YZX');
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, y, z), _q, _s);
      const row = frameRow(t.skin.clips[f.clip], f);
      for (const part of lod ? t.skin.far : t.skin.parts) {
        part.mesh.setMatrixAt(k, _m);
        part.frame.setX(k, row);
      }
      const ks = (near.get(modelId) ?? 0) + (far.get(modelId) ?? 0) - 1;
      if (ks < this.capacity)
        for (const part of t.skin.shadow) {
          part.mesh.setMatrixAt(ks, _m);
          part.frame.setX(ks, row);
        }
    }
    this.counts.clear();
    for (const [id, t] of this.templates) {
      const nn = near.get(id) ?? 0;
      const nf = far.get(id) ?? 0;
      this.counts.set(id, nn + nf);
      const sets: [typeof t.skin.parts, number][] = [
        [t.skin.parts, nn],
        [t.skin.far, nf],
        [t.skin.shadow, Math.min(this.capacity, nn + nf)],
      ];
      for (const [set, c] of sets)
        for (const part of set) {
          part.mesh.count = c;
          part.mesh.visible = c > 0;
          if (part.hull) {
            part.hull.count = c;
            part.hull.visible = c > 0 && hullsEnabled();
          }
          part.mesh.instanceMatrix.needsUpdate = true;
          part.frame.needsUpdate = true;
        }
    }
    for (const id of this.tracks.keys()) if (!live.has(id)) this.tracks.delete(id);
  }
}
