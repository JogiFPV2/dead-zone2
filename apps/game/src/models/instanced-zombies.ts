import {
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Matrix3,
  type Bone,
  DataTexture,
  Euler,
  FloatType,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshDepthMaterial,
  NearestFilter,
  Quaternion,
  Sphere,
  RGBADepthPacking,
  RGBAFormat,
  Vector3,
  type AnimationClip,
  type Camera,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { TICKS_PER_SECOND } from '@deadzone/sim';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { SnapshotAnim } from '@deadzone/protocol';
import { CROWD_SAMPLE_STRIDE, type CrowdBuffer } from '../crowd/crowd-buffer.js';
import { LEVEL_HEIGHT } from '../world/instances.js';
import {
  hullMaterial,
  hullsEnabled,
  registerCharacterMaterial,
  registerHull,
  withHullExtrusion,
} from '../render/style-materials.js';
import { CHARACTER_CLIPS, clipSource, findClip, type CharacterAnim } from './character-rig.js';
import type { BodyState, PhysState } from '../anim/contract.js';
import { gaitOf, gaitOffsets, type Gait, type GaitOffsets } from '../anim/gait.js';
import { gaitSeedOf } from '../anim/phys-adapter.js';
import { BodyMotion, ZOMBIE_MOTION } from '../anim/motion.js';
import {
  PoseTracker,
  RUN_CLIP_SPEED,
  newPose,
  type AnimPose,
  type PoseContext,
} from '../anim/pose.js';

/** Baked animation sample rate (frames per second of clip time). */
export const BAKE_FPS = 20;
/** Quaternius characters face +Z; the sim facing is local +X. */
const MODEL_YAW = Math.PI / 2;
/** Zombies farther than this from the view centre (tiles) use the low-poly LOD. */
export const LOD_DISTANCE = 14;
/** At most this many zombies (closest to the view centre) get the full mesh; the rest use the LOD. */
export const NEAR_BUDGET = 64;
/** Target fraction of triangles kept in the far LOD (capped by LOD_ERROR). */
export const LOD_RATIO = 0.3;
/** Max relative geometric error of the far LOD (~55% of triangles kept for the Quaternius models). */
const LOD_ERROR = 0.06;
/** Shadow proxies (silhouette only, sloppy decimation): fraction of triangles kept and max error. */
const SHADOW_RATIO = 0.12;
const SHADOW_ERROR = 1;
/** Culling sphere around a character (tiles, centred ~waist height; margin keeps edge shadows). */
const CULL_RADIUS = 1.6;
/** Zombie walk speed (tiles/s) at which the walk clip plays at the gait rate. */
const ZOMBIE_WALK_REF = 1.2;

/** Clips baked for zombies (the rest of CharacterAnim falls back to these, see bakedFrame). */
type BakedAnim = 'idle' | 'walk' | 'run' | 'attack' | 'dead' | 'hit' | 'stagger';
const ANIMS: readonly BakedAnim[] = ['idle', 'walk', 'run', 'attack', 'dead', 'hit', 'stagger'];
const BAKED: ReadonlySet<CharacterAnim> = new Set(ANIMS);
const ANIM_OF: Record<number, BodyState> = {
  [SnapshotAnim.idle]: 'idle',
  [SnapshotAnim.walk]: 'walk',
  [SnapshotAnim.run]: 'run',
  [SnapshotAnim.attack]: 'attack',
  [SnapshotAnim.dead]: 'dead',
};

/**
 * Colour-pass material of the shadow proxies: draws nothing (the shadow pass uses the baked
 * customDepthMaterial instead). three.js shadow maps filter by the main camera's layers, so a
 * layer can't make a mesh shadow-only.
 */
const SHADOW_ONLY = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });

export interface ClipRange {
  start: number;
  frames: number;
}

/** One sub-mesh of a template as an InstancedMesh with baked skinning. */
export interface Part {
  mesh: InstancedMesh;
  frame: InstancedBufferAttribute;
  /** Inverted-hull outline (same geometry, instances and baked frames), outline styles only. */
  hull?: InstancedMesh;
}

interface Template {
  parts: Part[];
  far: Part[];
  /** Low-poly shadow casters for every visible zombie (shadow-only layer). */
  shadow: Part[];
  clips: Record<BakedAnim, ClipRange>;
}

/** Baked clip that plays `anim` (clips zombies lack fall back to idle). */
function bakedAnim(anim: CharacterAnim): BakedAnim {
  const src = clipSource(anim).anim;
  return BAKED.has(src) ? (src as BakedAnim) : 'idle';
}

/** Bake texture row of `pose.anim` at clip time `pose.time` (s): loops wrap, one-shots clamp. */
function bakedFrame(clips: Record<BakedAnim, ClipRange>, pose: AnimPose): number {
  const src = clipSource(pose.anim);
  const r = clips[bakedAnim(pose.anim)];
  const f = Math.floor(pose.time * BAKE_FPS);
  const last = r.frames - 1;
  const k = pose.loop ? ((f % r.frames) + r.frames) % r.frames : Math.min(Math.max(f, 0), last);
  return r.start + (src.reverse ? last - k : k);
}

/**
 * Replaces the skinning bone lookup with the baked texture: row = per-instance `aFrame`,
 * texel column = bone × 4. Baked matrices are already in character-root space, so bindMatrix /
 * bindMatrixInverse are identity and `instanceMatrix` places the character. With vertex colours
 * (merged template) the emissive term is tinted by the vertex colour too, so a merged character
 * lights exactly like its separate per-material parts did.
 */
function patch(material: Material, bake: DataTexture): void {
  material.defines = { ...(material.defines ?? {}), USE_SKINNING: '' };
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uBake = { value: bake };
    shader.uniforms.bindMatrix = { value: new Matrix4() };
    shader.uniforms.bindMatrixInverse = { value: new Matrix4() };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <skinning_pars_vertex>',
      /* glsl */ `
      uniform mat4 bindMatrix;
      uniform mat4 bindMatrixInverse;
      uniform highp sampler2D uBake;
      attribute float aFrame;
      mat4 getBoneMatrix( const in float i ) {
        int x = int( i ) * 4;
        int y = int( aFrame );
        return mat4(
          texelFetch( uBake, ivec2( x, y ), 0 ),
          texelFetch( uBake, ivec2( x + 1, y ), 0 ),
          texelFetch( uBake, ivec2( x + 2, y ), 0 ),
          texelFetch( uBake, ivec2( x + 3, y ), 0 ) );
      }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
      #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
        totalEmissiveRadiance *= vColor.rgb;
      #endif`,
    );
  };
  material.customProgramCacheKey = () => `dz-baked-skin-${bake.id}`;
}

/** Same look parameters (everything except the base / emissive colour) → mergeable. */
function sameLook(a: MeshStandardMaterial, b: MeshStandardMaterial): boolean {
  return (
    !a.map &&
    !b.map &&
    a.roughness === b.roughness &&
    a.metalness === b.metalness &&
    a.transparent === b.transparent &&
    a.opacity === b.opacity &&
    a.side === b.side &&
    a.emissiveIntensity === b.emissiveIntensity &&
    a.flatShading === b.flatShading &&
    a.emissive.equals(a.color) === b.emissive.equals(b.color)
  );
}

/** Merged character: one geometry (bind pose applied, vertex colours) over a shared bone list. */
interface Merged {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  bones: Bone[];
  inverses: Matrix4[];
}

/**
 * Merges all skinned parts of a character into one geometry: vertices pre-multiplied by their
 * bindMatrix, skin indices remapped to a shared (bone, inverse) list, material colour → vertex
 * colour. Undefined when the parts can't share one material (textures, different PBR params).
 */
function mergeParts(skinned: readonly SkinnedMesh[]): Merged | undefined {
  const mats = skinned.map((m) => m.material);
  if (mats.some((m) => Array.isArray(m))) return undefined;
  const std = mats as MeshStandardMaterial[];
  if (!std.every((m) => sameLook(m, std[0]!))) return undefined;
  const bones: Bone[] = [];
  const inverses: Matrix4[] = [];
  const boneSlot = (bone: Bone, inv: Matrix4): number => {
    for (let i = 0; i < bones.length; i++) {
      if (bones[i] === bone && inverses[i]!.equals(inv)) return i;
    }
    bones.push(bone);
    inverses.push(inv.clone());
    return bones.length - 1;
  };
  let vertices = 0;
  let indices = 0;
  for (const m of skinned) {
    const n = m.geometry.getAttribute('position').count;
    vertices += n;
    indices += m.geometry.index?.count ?? n;
  }
  const pos = new Float32Array(vertices * 3);
  const nor = new Float32Array(vertices * 3);
  const col = new Float32Array(vertices * 3);
  const si = new Uint16Array(vertices * 4);
  const sw = new Float32Array(vertices * 4);
  const idx = new Uint32Array(indices);
  const v = new Vector3();
  const nm = new Matrix3();
  let vo = 0;
  let io = 0;
  for (const m of skinned) {
    const g = m.geometry;
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    const gi = g.getAttribute('skinIndex');
    const gw = g.getAttribute('skinWeight');
    const color = (m.material as MeshStandardMaterial).color;
    // Sources with vertex colours (textures baked to colours offline) keep them, tinted.
    const gc = g.getAttribute('color');
    nm.getNormalMatrix(m.bindMatrix);
    const remap = m.skeleton.bones.map((b, i) => boneSlot(b, m.skeleton.boneInverses[i]!));
    for (let i = 0; i < gp.count; i++) {
      const o = vo + i;
      v.fromBufferAttribute(gp, i)
        .applyMatrix4(m.bindMatrix)
        .toArray(pos, o * 3);
      if (gn)
        v.fromBufferAttribute(gn, i)
          .applyMatrix3(nm)
          .normalize()
          .toArray(nor, o * 3);
      color.toArray(col, o * 3);
      if (gc) {
        col[o * 3] = col[o * 3]! * gc.getX(i);
        col[o * 3 + 1] = col[o * 3 + 1]! * gc.getY(i);
        col[o * 3 + 2] = col[o * 3 + 2]! * gc.getZ(i);
      }
      for (let k = 0; k < 4; k++) {
        si[o * 4 + k] = remap[gi.getComponent(i, k)] ?? 0;
        sw[o * 4 + k] = gw.getComponent(i, k);
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = vo + g.index.getX(i);
    else for (let i = 0; i < gp.count; i++) idx[io++] = vo + i;
    vo += gp.count;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new BufferAttribute(nor, 3));
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(sw, 4));
  geometry.setIndex(new BufferAttribute(idx, 1));
  const material = std[0]!.clone();
  material.color.setRGB(1, 1, 1);
  if (std[0]!.emissive.equals(std[0]!.color)) material.emissive.setRGB(1, 1, 1);
  material.vertexColors = true;
  return { geometry, material, bones, inverses };
}

/** Zombie clips matched by name (missing ones bake as a single bind-pose frame). */
function zombieClips(clips: readonly AnimationClip[]): [BakedAnim, AnimationClip | undefined][] {
  return ANIMS.map((anim) => [anim, findClip(clips, CHARACTER_CLIPS[anim])]);
}

/** Bakes all clips of `object` (root at identity) into bone texture(s); one part if mergeable. */
function bakeTemplate(
  object: Object3D,
  clips: readonly AnimationClip[],
  capacity: number,
): Template {
  return bakeSkinned(object, zombieClips(clips), capacity, MODEL_YAW, 'zombie template');
}

/** Baked template of any skinned model: instanced parts, far LOD, shadow proxies, clip rows. */
export interface BakedSkin<K extends string> {
  parts: Part[];
  far: Part[];
  shadow: Part[];
  clips: Record<K, ClipRange>;
}

/**
 * Bakes `picked` clips (key → clip; a missing clip is one bind-pose frame) of a skinned
 * `object` turned by `yaw` into bone texture(s): one InstancedMesh per merged part (one in
 * total when the parts can share a material), plus a decimated LOD and shadow proxies.
 */
export function bakeSkinned<K extends string>(
  object: Object3D,
  picked: readonly (readonly [K, AnimationClip | undefined])[],
  capacity: number,
  yaw: number,
  label = 'template',
): BakedSkin<K> {
  object.position.set(0, 0, 0);
  object.rotation.set(0, yaw, 0);
  object.updateMatrixWorld(true);
  const skinned: SkinnedMesh[] = [];
  object.traverse((o) => {
    if ((o as Partial<SkinnedMesh>).isSkinnedMesh) skinned.push(o as SkinnedMesh);
  });
  const merged = mergeParts(skinned);
  if (!merged) console.warn(`${label}: parts not mergeable, one draw call per part`);
  // Bake sources: merged → one (bones, inverses, identity bind); else one per skinned part.
  const sources = merged
    ? [{ bones: merged.bones, inverses: merged.inverses, bind: new Matrix4() }]
    : skinned.map((m) => ({
        bones: m.skeleton.bones,
        inverses: m.skeleton.boneInverses,
        bind: m.bindMatrix,
      }));
  const ranges = {} as Record<K, ClipRange>;
  let rows = 0;
  for (const [key, clip] of picked) {
    const frames = clip ? Math.max(1, Math.ceil(clip.duration * BAKE_FPS)) : 1;
    ranges[key] = { start: rows, frames };
    rows += frames;
  }
  const mixer = new AnimationMixer(object);
  const data = sources.map((src) => new Float32Array(src.bones.length * 16 * rows));
  const tmp = new Matrix4();
  for (const [key, clip] of picked) {
    mixer.stopAllAction();
    if (clip) mixer.clipAction(clip).play();
    const r = ranges[key];
    for (let f = 0; f < r.frames; f++) {
      mixer.setTime(Math.min(f / BAKE_FPS, (clip?.duration ?? 0) - 1e-4));
      object.updateMatrixWorld(true);
      sources.forEach((src, k) => {
        const row = (r.start + f) * src.bones.length * 16;
        for (let b = 0; b < src.bones.length; b++) {
          tmp.multiplyMatrices(src.bones[b]!.matrixWorld, src.inverses[b]!).multiply(src.bind);
          tmp.toArray(data[k], row + b * 16);
        }
      });
    }
  }
  mixer.stopAllAction();
  const parts: Part[] = [];
  const far: Part[] = [];
  const shadow: Part[] = [];
  const geometries = merged ? [merged.geometry] : skinned.map((m) => m.geometry.clone());
  const materials = merged
    ? [merged.material]
    : skinned.map((m) => (m.material as MeshStandardMaterial).clone());
  sources.forEach((src, k) => {
    const tex = new DataTexture(data[k], src.bones.length * 4, rows, RGBAFormat, FloatType);
    tex.magFilter = tex.minFilter = NearestFilter;
    tex.needsUpdate = true;
    const material = materials[k]!;
    patch(material, tex);
    registerCharacterMaterial(material);
    const hullMat = hullMaterial('character');
    patch(hullMat, tex);
    withHullExtrusion(hullMat);
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    patch(depth, tex);
    const make = (geometry: BufferGeometry, mode: 'main' | 'shadow'): Part => {
      const frame = new InstancedBufferAttribute(new Float32Array(capacity), 1);
      frame.setUsage(DynamicDrawUsage);
      geometry.setAttribute('aFrame', frame);
      const mesh = new InstancedMesh(geometry, mode === 'main' ? material : SHADOW_ONLY, capacity);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.customDepthMaterial = depth;
      // Shadows come from one low-poly proxy per template (writes nothing in the colour pass).
      mesh.castShadow = mode === 'shadow';
      mesh.receiveShadow = mode === 'main';
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      if (mode === 'shadow') return { mesh, frame };
      const hull = new InstancedMesh(geometry, hullMat, capacity);
      hull.instanceMatrix = mesh.instanceMatrix;
      hull.frustumCulled = false;
      hull.count = 0;
      hull.visible = false;
      return { mesh, frame, hull };
    };
    const geometry = geometries[k]!;
    const low = simplified(geometry);
    parts.push(make(geometry, 'main'));
    far.push(make(low, 'main'));
    shadow.push(make(simplified(geometry, true), 'shadow'));
  });
  return { parts, far, shadow, clips: ranges };
}

/**
 * Low-poly copy of `source`: vertices welded by position + colour (seams from split normals
 * would otherwise block the simplifier), then meshopt-decimated. Welded vertices keep the first
 * source vertex's skinning / colour and the averaged normal.
 */
function simplified(source: BufferGeometry, sloppy = false): BufferGeometry {
  const pos = source.getAttribute('position');
  const col = source.getAttribute('color');
  const keyOf = new Map<string, number>();
  const rep: number[] = [];
  const weld = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const q = (x: number) => Math.round(x * 1e4);
    let key = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
    if (col) key += `|${q(col.getX(i))},${q(col.getY(i))},${q(col.getZ(i))}`;
    let w = keyOf.get(key);
    if (w === undefined) {
      w = rep.length;
      keyOf.set(key, w);
      rep.push(i);
    }
    weld[i] = w;
  }
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    if (name === 'aFrame') continue;
    const a = attr as BufferAttribute;
    const Ctor = a.array.constructor as new (n: number) => typeof a.array;
    const arr = new Ctor(rep.length * a.itemSize);
    for (let w = 0; w < rep.length; w++) {
      for (let c = 0; c < a.itemSize; c++)
        arr[w * a.itemSize + c] = a.array[rep[w]! * a.itemSize + c]!;
    }
    out.setAttribute(name, new BufferAttribute(arr, a.itemSize, a.normalized));
  }
  const nor = source.getAttribute('normal');
  if (nor) {
    const sum = new Float32Array(rep.length * 3);
    for (let i = 0; i < pos.count; i++) {
      const w = weld[i]!;
      sum[w * 3] = (sum[w * 3] ?? 0) + nor.getX(i);
      sum[w * 3 + 1] = (sum[w * 3 + 1] ?? 0) + nor.getY(i);
      sum[w * 3 + 2] = (sum[w * 3 + 2] ?? 0) + nor.getZ(i);
    }
    const n = new BufferAttribute(sum, 3);
    for (let w = 0; w < rep.length; w++) {
      const l = Math.hypot(n.getX(w), n.getY(w), n.getZ(w)) || 1;
      n.setXYZ(w, n.getX(w) / l, n.getY(w) / l, n.getZ(w) / l);
    }
    out.setAttribute('normal', n);
  }
  const src = source.index;
  const count = src ? src.count : pos.count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = weld[src ? src.getX(i) : i]!;
  const positions = new Float32Array(rep.length * 3);
  for (let w = 0; w < rep.length; w++) {
    positions[w * 3] = pos.getX(rep[w]!);
    positions[w * 3 + 1] = pos.getY(rep[w]!);
    positions[w * 3 + 2] = pos.getZ(rep[w]!);
  }
  const ratio = sloppy ? SHADOW_RATIO : LOD_RATIO;
  const target = Math.max(3, Math.floor((count * ratio) / 3) * 3);
  const [lod] = sloppy
    ? MeshoptSimplifier.simplifySloppy(index, positions, 3, null, target, SHADOW_ERROR)
    : MeshoptSimplifier.simplify(index, positions, 3, target, LOD_ERROR, ['LockBorder']);
  out.setIndex(new BufferAttribute(lod, 1));
  return out;
}

/** Physics / animation state source (`anim/phys-adapter.ts`). */
export interface ZombiePhysSource {
  get(id: number): PhysState | undefined;
}

/** Per-zombie view state: smoothed body, pose choice, gait. */
interface AnimState {
  motion: BodyMotion;
  tracker: PoseTracker;
  pose: AnimPose;
  gait: Gait;
  seed: number;
  /** Locomotion clip time (s). */
  loopTime: number;
  lastS: number;
  /** Fallback state without an adapter (mock crowd). */
  own: PhysState;
}

const ownState = (): PhysState => ({
  facing: 0,
  vel: { x: 0, y: 0 },
  maxSpeed: 0,
  state: 'idle',
  stateStartTick: 0,
  stateDuration: 0,
  knockback: { dirX: 0, dirY: 0, strength: 0 },
  lastHitTick: -1,
  hitFromDir: 0,
  gaitSeed: 0,
});

/**
 * Loop playback rate of a zombie: the clip follows the drawn speed (the sim already varies the
 * pace +-20%); the gait only sets the per-zombie cadence of the shamble (step length look).
 */
function zombieLoopRate(anim: CharacterAnim, speed: number, g: Gait): number {
  const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
  if (anim === 'walk') return g.rate * clamp(speed / ZOMBIE_WALK_REF, 0.6, 1.4);
  if (anim === 'run') return (0.8 + 0.4 * g.rate) * clamp(speed / RUN_CLIP_SPEED, 0.6, 1.3);
  return 0.6 + 0.5 * g.rate;
}

/**
 * All zombies as GPU-instanced skinned characters: animations baked into bone textures,
 * one InstancedMesh per template sub-mesh (draw calls independent of the zombie count).
 */
export class InstancedZombies {
  readonly root = new Group();
  private readonly templates: Template[];
  private readonly state = new Map<number, AnimState>();
  private sampled = new Float32Array(0);
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly e = new Euler();
  /** Reused pose context (no allocation per zombie). */
  private readonly ctx: PoseContext = {
    weapon: 'unarmed',
    speed: 0,
    clipLen: (a) => (this.templates[0]?.clips[bakedAnim(a)].frames ?? BAKE_FPS) / BAKE_FPS,
    loopTime: 0,
  };
  private readonly go: GaitOffsets = { roll: 0, pitch: 0, yaw: 0, bob: 0 };

  private readonly frustum = new Frustum();
  private readonly sphere = new Sphere(new Vector3(), CULL_RADIUS);
  private readonly vp = new Matrix4();

  /** Bakes the templates (waits for the mesh simplifier used by the far LOD). */
  static async create(
    templates: readonly { object: Object3D; clips: AnimationClip[] }[],
    buffer: CrowdBuffer,
    capacity = 512,
  ): Promise<InstancedZombies> {
    await MeshoptSimplifier.ready;
    return new InstancedZombies(templates, buffer, capacity);
  }

  private constructor(
    templates: readonly { object: Object3D; clips: AnimationClip[] }[],
    private readonly buffer: CrowdBuffer,
    private capacity: number,
  ) {
    this.templates = templates.map((t) => bakeTemplate(t.object, t.clips, capacity));
    for (const t of this.templates)
      for (const p of [...t.parts, ...t.far, ...t.shadow]) {
        this.root.add(p.mesh);
        if (p.hull) {
          this.root.add(p.hull);
          registerHull(p.hull);
        }
      }
  }

  /**
   * Places every zombie in view: frustum-culled per instance, full mesh near the view centre
   * (`cx`, `cz`), decimated LOD farther out. `phys` / `tickF`: contract state per zombie and
   * the fractional sim tick (without them, a minimal state from the snapshot anim).
   */
  update(
    alpha: number,
    nowS: number,
    camera: Camera,
    cx: number,
    cz: number,
    phys?: ZombiePhysSource,
    tickF = nowS * TICKS_PER_SECOND,
  ): void {
    const b = this.buffer;
    if (this.sampled.length < b.capacity * CROWD_SAMPLE_STRIDE) {
      this.sampled = new Float32Array(b.capacity * CROWD_SAMPLE_STRIDE);
    }
    const n = b.sample(alpha, this.sampled);
    const counts = this.templates.map(() => [0, 0, 0]);
    const seen = new Set<number>();
    const lod2 = LOD_DISTANCE * LOD_DISTANCE;
    const vis: number[] = [];
    const dist: number[] = [];
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(
      this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    for (let i = 0; i < n; i++) {
      const id = b.slots.idAt(i);
      seen.add(id);
      const s = i * CROWD_SAMPLE_STRIDE;
      const x = this.sampled[s] ?? 0;
      const z = this.sampled[s + 1] ?? 0;
      const y = (this.sampled[s + 2] ?? 0) * LEVEL_HEIGHT;
      this.sphere.center.set(x, y + 0.9, z);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      vis.push(i);
      dist.push((x - cx) ** 2 + (z - cz) ** 2);
    }
    let cutoff = lod2;
    if (vis.length > NEAR_BUDGET) {
      const sorted = dist.slice().sort((a, b2) => a - b2);
      cutoff = Math.min(lod2, sorted[NEAR_BUDGET - 1] ?? lod2);
    }
    vis.forEach((i, vi) => {
      const id = b.slots.idAt(i);
      const s = i * CROWD_SAMPLE_STRIDE;
      const st = this.animState(id, nowS);
      const ps = phys?.get(id) ?? this.fallback(st, b.anim[i] ?? 0, tickF);
      const frame = this.posed(st, ps, s, nowS, tickF);
      const ti = id % this.templates.length;
      const t = this.templates[ti]!;
      const lod = (dist[vi] ?? 0) > cutoff ? 1 : 0;
      const c = counts[ti]!;
      const k = c[lod]!;
      if (k >= this.capacity) return;
      c[lod] = k + 1;
      const row = bakedFrame(t.clips, frame);
      for (const part of lod ? t.far : t.parts) {
        part.mesh.setMatrixAt(k, this.m);
        part.frame.setX(k, row);
      }
      const ks = c[2]!;
      c[2] = ks + 1;
      for (const part of t.shadow) {
        part.mesh.setMatrixAt(ks, this.m);
        part.frame.setX(ks, row);
      }
    });
    this.templates.forEach((t, ti) => {
      [t.parts, t.far, t.shadow].forEach((set, lod) => {
        const n = counts[ti]![lod]!;
        for (const part of set) {
          part.mesh.count = n;
          part.mesh.visible = n > 0;
          if (part.hull) {
            part.hull.count = n;
            part.hull.visible = n > 0 && hullsEnabled();
          }
          part.mesh.instanceMatrix.needsUpdate = true;
          part.frame.needsUpdate = true;
        }
      });
    });
    for (const id of this.state.keys()) if (!seen.has(id)) this.state.delete(id);
  }

  private animState(id: number, nowS: number): AnimState {
    let st = this.state.get(id);
    if (!st) {
      const seed = gaitSeedOf(id);
      const gait = gaitOf(seed);
      st = {
        seed,
        motion: new BodyMotion(),
        tracker: new PoseTracker(),
        pose: newPose(),
        gait,
        loopTime: gait.phase * 2,
        lastS: nowS,
        own: ownState(),
      };
      this.state.set(id, st);
    }
    return st;
  }

  /** Minimal contract state from the snapshot anim (mock crowd, no adapter). */
  private fallback(st: AnimState, anim: number, tickF: number): PhysState {
    const o = st.own;
    const next = ANIM_OF[anim] ?? 'idle';
    if (o.state !== next) {
      o.state = next;
      o.stateStartTick = Math.floor(tickF);
      o.stateDuration = next === 'attack' ? 8 : 0;
    }
    return o;
  }

  /** Smooths the body, picks the clip and writes the instance matrix into `this.m`. */
  private posed(st: AnimState, ps: PhysState, s: number, nowS: number, tickF: number): AnimPose {
    const dt = Math.min(1, Math.max(0, nowS - st.lastS));
    st.lastS = nowS;
    const sm = this.sampled;
    const mo = st.motion;
    // The contract gait seed wins (same as the client default until the sim sends its own).
    if (ps.gaitSeed && ps.gaitSeed !== st.seed) {
      st.seed = ps.gaitSeed;
      st.gait = gaitOf(ps.gaitSeed);
    }
    const ctx = this.ctx;
    ctx.speed = mo.speed;
    ctx.loopTime = st.loopTime;
    ctx.vz = mo.vz;
    const pose = st.tracker.pose(ps, tickF, ctx, st.pose);
    const g = st.gait;
    const turning = !Number.isNaN(pose.faceTo);
    mo.update(
      sm[s] ?? 0,
      sm[s + 1] ?? 0,
      sm[s + 2] ?? 0,
      turning ? pose.faceTo : (sm[s + 3] ?? 0),
      ps.vel.x * TICKS_PER_SECOND,
      ps.vel.y * TICKS_PER_SECOND,
      dt,
      ZOMBIE_MOTION,
      turning ? 10 : g.turnRate,
      pose.lockFacing,
    );
    st.loopTime += dt * zombieLoopRate(pose.anim, mo.speed, g);
    const go = this.go;
    if (pose.loop) gaitOffsets(g, nowS, pose.move, go);
    else go.roll = go.pitch = go.yaw = go.bob = 0;
    this.e.set(pose.roll + go.roll, -(mo.facing + go.yaw), -(pose.pitch + go.pitch), 'YZX');
    this.q.setFromEuler(this.e);
    this.p.set(mo.x, mo.z * LEVEL_HEIGHT + go.bob + pose.lift, mo.y);
    this.m.compose(this.p, this.q, this.s);
    return pose;
  }
}
