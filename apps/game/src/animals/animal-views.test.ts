import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AnimationClip,
  Bone,
  Box3,
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  VectorKeyframeTrack,
  type InstancedMesh,
} from 'three';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  SnapshotAnim,
  SnapshotEntityKind,
  encodeSnapshot,
  type SnapshotEntity,
} from '@deadzone/protocol';
import { CrowdBuffer } from '../crowd/crowd-buffer.js';
import { startAnimalCount } from './animal-count.js';
import {
  ANIMAL_SPECIES,
  FALLBACK_SPECIES,
  HIDDEN_ANIMAL_TYPES,
  animalTypeIds,
  speciesOf,
  variantOf,
  type AnimalClip,
} from './animal-species.js';
import {
  AnimalViews,
  animalPose,
  bakeAnimal,
  loopRate,
  prepareAnimal,
  towardPalette,
  type AnimalTemplate,
  type AnimalTrack,
} from './animal-views.js';

const ROOT = join(__dirname, '../../../..');
const DIR = join(ROOT, 'packages/content/data/base/animal-types');
const files = readdirSync(DIR).map((f) => ({
  path: `animal-types/${f}`,
  json: JSON.parse(readFileSync(join(DIR, f), 'utf8')) as unknown,
}));
const TYPES = animalTypeIds(files);
const A = SnapshotEntityKind.animal;

describe('animal species (CC0 models)', () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'apps/game/public/models/manifest.json'), 'utf8'),
  ) as { assets: { id: string; pack: string }[]; packs: { id: string; licence: string }[] };
  const packs = readdirSync(join(ROOT, 'tools/assets/packs')).map(
    (f) =>
      JSON.parse(readFileSync(join(ROOT, 'tools/assets/packs', f), 'utf8')) as {
        id: string;
        keepAnimations?: string[];
      },
  );

  it('every base animal type has a look whose models are CC0 pipeline assets', () => {
    expect(TYPES).toEqual([...TYPES].sort());
    const shown = TYPES.filter((id) => !HIDDEN_ANIMAL_TYPES.has(id));
    expect(shown).toEqual(Object.keys(ANIMAL_SPECIES).sort());
    for (const id of shown)
      for (const m of ANIMAL_SPECIES[id]!.models) {
        const asset = manifest.assets.find((a) => a.id === m.id);
        expect(asset, m.id).toBeDefined();
        expect(manifest.packs.find((p) => p.id === asset!.pack)?.licence).toBe('CC0-1.0');
      }
  });

  it("every clip a species plays survives the pipeline's clip filter", () => {
    for (const id of Object.keys(ANIMAL_SPECIES))
      for (const m of ANIMAL_SPECIES[id]!.models) {
        const pack = packs.find((p) => p.id === m.id.split('/')[0]);
        for (const clip of Object.values(ANIMAL_SPECIES[id]!.clips))
          expect(pack?.keepAnimations, `${m.id} ${clip}`).toContain(clip);
      }
  });

  it('sizes: deer > dog > cat > rabbit; every walker has walk + idle', () => {
    const len = (id: string) => ANIMAL_SPECIES[id]!.models[0]!.length;
    expect(len('base:deer')).toBeGreaterThan(len('base:dog'));
    expect(len('base:dog')).toBeGreaterThan(len('base:cat'));
    expect(len('base:cat')).toBeGreaterThan(len('base:rabbit'));
    for (const id of Object.keys(ANIMAL_SPECIES)) {
      const s = ANIMAL_SPECIES[id]!;
      expect(s.clips.idle, id).toBeDefined();
      if (!s.flies) expect(s.clips.walk, id).toBeDefined();
      else expect(s.clips.fly, id).toBeDefined();
    }
  });

  it('variants by stable id: about 30 % stags among the deer, deterministic', () => {
    const deer = ANIMAL_SPECIES['base:deer']!;
    const ids = Array.from({ length: 1000 }, (_, k) => k + 1);
    const stags = ids.filter((i) => variantOf(deer, i) === 1).length;
    expect(stags).toBeGreaterThan(250);
    expect(stags).toBeLessThan(350);
    expect(variantOf(deer, 7)).toBe(variantOf(deer, 7));
    expect(variantOf(ANIMAL_SPECIES['base:cat']!, 7)).toBe(0);
    expect(speciesOf('mod:yak')).toBe(ANIMAL_SPECIES[FALLBACK_SPECIES]);
  });

  it('squirrels are hidden: no look, not populated by the sim (spawnWeight 0)', () => {
    expect(speciesOf('base:squirrel')).toBeUndefined();
    const sq = files.find((f) => f.path === 'animal-types/squirrel.json');
    expect(sq).toBeDefined();
    expect((sq!.json as { spawnWeight?: number }).spawnWeight).toBe(0);
  });

  it('colours without a species entry move towards the game palette', () => {
    const c = new Color(0.9, 0.1, 0.8);
    const before = c.clone();
    towardPalette(c);
    expect(c.equals(before)).toBe(false);
    // A palette colour stays itself.
    const p = new Color(0x5e6170);
    expect(towardPalette(p.clone()).getHex()).toBe(p.getHex());
  });

  it('start count scales with the map (8 chunks … 300), ?animals overrides', () => {
    expect(startAnimalCount({ cx0: 0, cy0: 0, cx1: 1, cy1: 1, z: 0 })).toBe(6);
    expect(startAnimalCount({ cx0: 0, cy0: 0, cx1: 15, cy1: 15, z: 0 })).toBe(102);
    expect(startAnimalCount({ cx0: 0, cy0: 0, cx1: 99, cy1: 99, z: 0 })).toBe(300);
    expect(startAnimalCount({ cx0: 0, cy0: 0, cx1: 99, cy1: 99, z: 0 }, 0)).toBe(0);
  });
});

describe('animalPose (clip per sim state, anim 0/1/4/5)', () => {
  const all: ReadonlySet<AnimalClip> = new Set(['idle', 'eat', 'walk', 'run', 'death']);
  const tr = (o: Partial<AnimalTrack> = {}): AnimalTrack => ({
    anim: 0,
    since: 0,
    loopTime: 0.3,
    offset: 0,
    ...o,
  });
  const deer = ANIMAL_SPECIES['base:deer']!;

  it('walk / run / death / eat from the pack clips', () => {
    expect(animalPose(deer, all, SnapshotAnim.walk, 0.9, tr(), 0).clip).toBe('walk');
    expect(animalPose(deer, all, SnapshotAnim.flee, 6, tr(), 0).clip).toBe('run');
    const dead = animalPose(deer, all, SnapshotAnim.dead, 0, tr({ since: 0.4 }), 0);
    expect(dead).toMatchObject({ clip: 'death', time: 0.4, loop: false, roll: 0 });
    // Idle: eating for half of every 12 s, standing the other half.
    expect(animalPose(deer, all, SnapshotAnim.idle, 0, tr(), 1).clip).toBe('eat');
    expect(animalPose(deer, all, SnapshotAnim.idle, 0, tr(), 8).clip).toBe('idle');
    // Moving although the sim says idle (still decelerating): walk.
    expect(animalPose(deer, all, SnapshotAnim.idle, 1, tr(), 8).clip).toBe('walk');
  });

  it('fallbacks: no death clip → idle rolled onto the side; no run → faster walk', () => {
    const cat = ANIMAL_SPECIES['base:cat']!;
    const has: ReadonlySet<AnimalClip> = new Set(['idle', 'walk']);
    const dead = animalPose(cat, has, SnapshotAnim.dead, 0, tr({ since: 1 }), 0);
    expect(dead.clip).toBe('idle');
    expect(dead.roll).toBeCloseTo(Math.PI / 2);
    const flee = animalPose(cat, has, SnapshotAnim.flee, 5, tr(), 0);
    expect(flee.clip).toBe('walk');
    expect(loopRate(cat, has, flee, 5)).toBeGreaterThan(loopRate(cat, has, flee, 0.7) * 2);
  });

  it('a fleeing bird flies off (climbs to 4 m), a walking one hops', () => {
    const bird = ANIMAL_SPECIES['base:bird']!;
    const has: ReadonlySet<AnimalClip> = new Set(['idle', 'fly']);
    const up = (since: number) =>
      animalPose(bird, has, SnapshotAnim.flee, 8, tr({ since }), 0).lift;
    expect(animalPose(bird, has, SnapshotAnim.flee, 8, tr(), 0).clip).toBe('fly');
    expect(up(0.5)).toBeGreaterThan(up(0.1));
    expect(up(10)).toBe(4);
    expect(animalPose(bird, has, SnapshotAnim.walk, 0.6, tr(), 0.1).lift).toBeGreaterThan(0);
  });

  it('locomotion rate follows the ground speed (no foot sliding)', () => {
    const f = animalPose(deer, all, SnapshotAnim.walk, 0.9, tr(), 0);
    expect(loopRate(deer, all, f, 0.9)).toBeCloseTo(1);
    expect(loopRate(deer, all, f, 1.35)).toBeCloseTo(1.5);
    const r = animalPose(deer, all, SnapshotAnim.flee, 6.5, tr(), 0);
    expect(loopRate(deer, all, r, 6.5)).toBeCloseTo(1);
  });
});

/** Tiny skinned box (one bone) with a walk clip, like a pack model. */
function fakeModel(): { object: Group; clips: AnimationClip[] } {
  const geo = new BoxGeometry(2, 1, 0.5);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(
      new Float32Array(n * 4).map((_, i) => (i % 4 ? 0 : 1)),
      4,
    ),
  );
  const bone = new Bone();
  bone.name = 'bone';
  const mesh = new SkinnedMesh(geo, new MeshStandardMaterial({ name: 'Main' }));
  const object = new Group();
  object.add(bone, mesh);
  mesh.bind(new Skeleton([bone]));
  const walk = new AnimationClip('Armature|Walk', 1, [
    new VectorKeyframeTrack('bone.position', [0, 1], [0, 0, 0, 0, 0.2, 0]),
  ]);
  return { object, clips: [walk, new AnimationClip('Armature|Idle', 1, [])] };
}

describe('AnimalViews (instanced, baked clips)', () => {
  let templates: Map<string, AnimalTemplate>;
  beforeAll(async () => {
    await MeshoptSimplifier.ready;
    templates = new Map();
    for (const typeId of ['base:deer', 'base:dog']) {
      const s = ANIMAL_SPECIES[typeId]!;
      const ref = s.models[0]!;
      const { object, clips } = fakeModel();
      templates.set(ref.id, bakeAnimal(prepareAnimal(object, s, ref), clips, s, 16));
    }
  });
  const player: SnapshotEntity = { stableId: 1, x: 0, y: 0, z: 0, facingRad: 0, kind: 1 };
  const animal = (id: number, type: string, more: Partial<SnapshotEntity> = {}) =>
    ({
      stableId: id,
      x: 10 + id,
      y: 5,
      z: 0,
      facingRad: 0,
      kind: A,
      variant: TYPES.indexOf(type),
      ...more,
    }) satisfies SnapshotEntity;
  function setup(...ents: SnapshotEntity[]) {
    const buf = new CrowdBuffer(16, 16, (k) => k === A);
    const views = new AnimalViews(buf, TYPES, templates, 16);
    const push = (...e: SnapshotEntity[]) =>
      buf.push(new Float32Array(encodeSnapshot([player, ...e])), 1);
    push(...ents);
    return { buf, views, push };
  }
  const meshOf = (v: AnimalViews, id: string) =>
    v.root.children.find((c) => c.name === id && (c as InstancedMesh).castShadow === false) as
      InstancedMesh | undefined;

  it('prepares a model to its length, nose on +X, feet on the ground', () => {
    const s = ANIMAL_SPECIES['base:dog']!;
    const ref = s.models[0]!;
    const { object } = fakeModel();
    const root = prepareAnimal(object, s, ref);
    root.updateMatrixWorld(true);
    const b = new Vector3();
    const size = new Vector3();
    const bb = new Box3().setFromObject(root);
    bb.getSize(size);
    bb.getCenter(b);
    // Fake box is 0.5 deep along z, Quaternius-style yaw π/2 turns it to x.
    expect(size.x).toBeCloseTo(ref.length, 3);
    expect(bb.min.y).toBeCloseTo(0, 3);
    expect(b.x).toBeCloseTo(0, 3);
  });

  it('draws each animal with its model at the snapshot position; zombies stay out', () => {
    const { views, buf } = setup(
      animal(2, 'base:deer'),
      animal(4, 'base:dog'),
      animal(5, 'base:dog'),
      { ...animal(6, 'base:deer'), kind: SnapshotEntityKind.zombie },
    );
    views.update(1, 0);
    expect(buf.count).toBe(3);
    const deerId = views.modelOf('base:deer', 2)!;
    expect(views.drawn()).toEqual({ [deerId]: 1, 'quaternius-animals/shiba-inu': 2 });
    const m = new Matrix4();
    meshOf(views, deerId)!.getMatrixAt(0, m);
    const p = new Vector3().setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(12, 3);
    expect(p.z).toBeCloseTo(5, 3);
  });

  it('drops animals missing from the next snapshot; unknown types use the fallback look', () => {
    const { views, push } = setup(animal(2, 'base:dog'), animal(3, 'base:dog'));
    views.update(1, 0);
    push(animal(3, 'base:dog'), { ...animal(9, 'base:dog'), variant: 40 });
    views.update(1, 0.1);
    expect(views.drawn()).toEqual({ 'quaternius-animals/shiba-inu': 2 });
  });

  it('baked rows: a walking animal changes frame over time', () => {
    const { views } = setup(animal(4, 'base:dog', { anim: SnapshotAnim.walk, speed: 1 }));
    const id = 'quaternius-animals/shiba-inu';
    const frame = () => {
      const part = templates.get(id)!.skin.parts[0]!;
      return part.frame.getX(0);
    };
    // View centre next to it: the full mesh (not the far LOD).
    views.update(1, 0, undefined, 14, 5);
    const a = frame();
    views.update(1, 0.1, undefined, 14, 5);
    views.update(1, 0.2, undefined, 14, 5);
    expect(frame()).not.toBe(a);
  });
});
