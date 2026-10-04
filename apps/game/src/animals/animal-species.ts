/**
 * Animal looks: the CC0 model(s) of every base animal type, how to fit them, which clip plays
 * which state and the colours (matched to the game palette). Models come from the asset
 * pipeline (`tools/assets/packs/quaternius-animals*.json`, `cdmir-rabbit.json`; licences in
 * ASSETS.md). Data only, so tests can check it without loading anything.
 */

/** Baked clip slots of an animal (anim 0 idle / eat, 1 walk, 2 + 5 run / fly, 4 death). */
export type AnimalClip = 'idle' | 'eat' | 'walk' | 'run' | 'fly' | 'death';
export const ANIMAL_CLIPS: readonly AnimalClip[] = ['idle', 'eat', 'walk', 'run', 'fly', 'death'];

export interface AnimalSpecies {
  /** Asset ids (`<pack>/<model>`); several = variants picked by stable id (deer / stag). */
  models: readonly AnimalModelRef[];
  /** Clip name per slot (suffix after `Armature|`); missing slots fall back (see pose). */
  clips: Partial<Record<AnimalClip, string>>;
  /** Ground speed (m/s) at which the walk / run clip plays at its own rate (no foot sliding). */
  walkRef: number;
  runRef: number;
  /** Flies off when fleeing (birds): climbs instead of running. */
  flies?: boolean;
  /**
   * Material name (prefix) → colour (sRGB hex); other materials are pulled towards the game
   * palette (`towardPalette`).
   */
  colours?: Record<string, number>;
}

export interface AnimalModelRef {
  id: string;
  /** Model yaw (rad) that turns its nose to local +X (Quaternius animals face +Z: π/2). */
  yaw: number;
  /** Nose-to-tail length (m) the model is scaled to. */
  length: number;
  /** Share of the stable ids drawn with this variant (the rest: the first model). */
  share?: number;
}

const FACE_Z = Math.PI / 2;

export const ANIMAL_SPECIES: Readonly<Record<string, AnimalSpecies>> = {
  'base:deer': {
    // Roe deer does, now and then a red deer stag (Quaternius Ultimate Animated Animals).
    models: [
      { id: 'quaternius-animals/deer', yaw: FACE_Z, length: 1.25 },
      { id: 'quaternius-animals/stag', yaw: FACE_Z, length: 1.75, share: 0.3 },
    ],
    clips: { idle: 'Idle', eat: 'Eating', walk: 'Walk', run: 'Gallop', death: 'Death' },
    walkRef: 0.9,
    runRef: 6.5,
  },
  'base:dog': {
    models: [{ id: 'quaternius-animals/shiba-inu', yaw: FACE_Z, length: 0.85 }],
    clips: { idle: 'Idle', eat: 'Eating', walk: 'Walk', run: 'Gallop', death: 'Death' },
    walkRef: 1,
    runRef: 5.5,
  },
  'base:cat': {
    // Grey tabby (colours set in tools/assets/src/animal-sources.ts: the FBX is grey only).
    models: [{ id: 'quaternius-animals-vol2/cat', yaw: 0, length: 0.75 }],
    clips: { idle: 'Idle', walk: 'Walking' },
    walkRef: 0.7,
    runRef: 2.2,
  },
  'base:rabbit': {
    // Brown hare look baked from the photo texture into vertex colours (tools/assets).
    models: [{ id: 'cdmir-rabbit/rabbit', yaw: FACE_Z, length: 0.42 }],
    clips: {
      idle: 'Sitting.000',
      eat: 'Sitting.001',
      walk: 'Jump',
      run: 'Running',
      death: 'Dying.000',
    },
    walkRef: 0.8,
    runRef: 5.5,
  },
  'base:bird': {
    // A feral pigeon (CC0, mujtaba-io): perched clip added at export, plumage baked into vertex
    // colours (tools/assets/src/animal-sources.ts). The Blender export faces -Z.
    models: [{ id: 'mujtaba-pigeon/pigeon', yaw: -FACE_Z, length: 0.36 }],
    clips: { idle: 'perch-animation', fly: 'flap-wings-animation' },
    walkRef: 0.6,
    runRef: 8,
    flies: true,
    colours: { Pigeon: 0xffffff },
  },
};

/** Type used for animal types without a look of their own (mods). */
export const FALLBACK_SPECIES = 'base:dog';

/**
 * Base types with no acceptable model yet: not drawn at all (the sim doesn't populate them,
 * `spawnWeight` 0; one spawned anyway, e.g. by a dev command, stays invisible). No CC0 animated
 * squirrel exists.
 */
export const HIDDEN_ANIMAL_TYPES: ReadonlySet<string> = new Set(['base:squirrel']);

/** Look of a content animal type (mod types → FALLBACK_SPECIES; hidden types → none). */
export const speciesOf = (typeId: string): AnimalSpecies | undefined =>
  HIDDEN_ANIMAL_TYPES.has(typeId)
    ? undefined
    : (ANIMAL_SPECIES[typeId] ?? ANIMAL_SPECIES[FALLBACK_SPECIES]!);

/** Variant index of a species for a stable id (deterministic, `share` per extra model). */
export function variantOf(s: AnimalSpecies, id: number): number {
  const u = (((id * 0.6180339887) % 1) + 1) % 1;
  let acc = 0;
  for (let k = 1; k < s.models.length; k++) {
    acc += s.models[k]!.share ?? 0;
    if (u < acc) return k;
  }
  return 0;
}

/** Sorted animal type ids of the base pack files (= snapshot `variant` order of the sim). */
export function animalTypeIds(
  files: readonly ({ path: string; json: unknown } | { path: string; text: string })[],
): string[] {
  const ids: string[] = [];
  for (const f of files) {
    if (!f.path.startsWith('animal-types/')) continue;
    let json: unknown;
    try {
      json = 'json' in f ? f.json : JSON.parse(f.text);
    } catch {
      continue;
    }
    const id = (json as { id?: unknown } | null)?.id;
    if (typeof id === 'string') ids.push(id);
  }
  return ids.sort();
}
