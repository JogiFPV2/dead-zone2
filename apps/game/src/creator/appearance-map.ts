/**
 * Content appearance parts → Quaternius character meshes (CC0, `quaternius-characters/*`).
 * The three models share one armature (`CharacterArmature`), so any Head / Body / Legs / Feet
 * mesh can be rebound to the base skeleton. Face and hair are one Quaternius mesh, so the head
 * is offered as preset variants (face+hair, or the merged `head` slot of PR #38).
 */
export type ModelId = 'casual' | 'worker' | 'hoodie';
export type MeshPart = 'Head' | 'Body' | 'Legs' | 'Feet';
export type Channel = 'primary' | 'secondary';
export type ClothSlot = 'top' | 'bottom' | 'shoes';

export const MODEL_ASSET: Record<ModelId, string> = {
  casual: 'quaternius-characters/casual',
  worker: 'quaternius-characters/worker',
  hoodie: 'quaternius-characters/hoodie',
};
/** Mesh node prefix inside each GLB (`Casual2_Head`, `Worker_Body`, `Casual_Legs`). */
export const MESH_PREFIX: Record<ModelId, string> = {
  casual: 'Casual2_',
  worker: 'Worker_',
  hoodie: 'Casual_',
};
export const MESH_PARTS: readonly MeshPart[] = ['Head', 'Body', 'Legs', 'Feet'];

/** Material tinted by a color channel; `mul` darkens / brightens the color (shading parts). */
export interface MaterialTint {
  material: string;
  channel: Channel;
  mul?: number;
}

export interface MeshRef {
  model: ModelId;
  mesh: MeshPart;
  /** Materials hidden on this mesh (bald = no `Hair`, the worker's helmet). */
  hide?: readonly string[];
  tints: readonly MaterialTint[];
}

export interface HeadPreset {
  id: string;
  label: string;
  mesh: MeshRef;
  /** Whether the hair color applies (bald heads have none). */
  hair: boolean;
  /** Spec parts per content scheme: merged `head` slot, or separate `face` + `hair`. */
  head: string;
  face: string;
  hairPart: string;
}

export const HEAD_PRESETS: readonly HeadPreset[] = [
  {
    id: 'short',
    label: 'Krótkie',
    mesh: { model: 'casual', mesh: 'Head', tints: [{ material: 'Hair', channel: 'primary' }] },
    hair: true,
    head: 'base:head-short',
    face: 'base:face-a',
    hairPart: 'base:hair-short',
  },
  {
    id: 'messy',
    label: 'Dłuższe',
    mesh: { model: 'hoodie', mesh: 'Head', tints: [{ material: 'Hair', channel: 'primary' }] },
    hair: true,
    head: 'base:head-messy',
    face: 'base:face-b',
    hairPart: 'base:hair-messy',
  },
  {
    id: 'moustache',
    label: 'Wąsy',
    mesh: {
      model: 'worker',
      mesh: 'Head',
      hide: ['Worker_Yellow'],
      tints: [{ material: 'Moustache', channel: 'primary' }],
    },
    hair: true,
    head: 'base:head-short-beard',
    face: 'base:face-c',
    hairPart: 'base:hair-buzz',
  },
  {
    id: 'bald',
    label: 'Łyse',
    mesh: { model: 'casual', mesh: 'Head', hide: ['Hair'], tints: [] },
    hair: false,
    head: 'base:head-bald',
    face: 'base:face-a',
    hairPart: 'base:hair-bald',
  },
  {
    id: 'bald-b',
    label: 'Łyse B',
    mesh: { model: 'hoodie', mesh: 'Head', hide: ['Hair'], tints: [] },
    hair: false,
    head: 'base:head-buzz',
    face: 'base:face-b',
    hairPart: 'base:hair-buzz',
  },
];

export interface ClothOption {
  part: string;
  label: string;
  mesh: MeshRef;
}

const p = (material: string, mul?: number): MaterialTint => ({
  material,
  channel: 'primary',
  ...(mul !== undefined ? { mul } : {}),
});
const s = (material: string): MaterialTint => ({ material, channel: 'secondary' });

export const CLOTH_OPTIONS: Record<ClothSlot, readonly ClothOption[]> = {
  top: [
    {
      part: 'base:top-hoodie',
      label: 'Bluza z kapt.',
      mesh: { model: 'hoodie', mesh: 'Body', tints: [p('Purple')] },
    },
    {
      part: 'base:top-t-shirt',
      label: 'Koszulka',
      mesh: { model: 'casual', mesh: 'Body', tints: [p('LightBrown')] },
    },
    {
      part: 'base:top-work-jacket',
      label: 'Kamizelka',
      mesh: { model: 'worker', mesh: 'Body', tints: [p('Worker_Vest'), s('Worker_Yellow')] },
    },
  ],
  bottom: [
    {
      part: 'base:bottom-jeans',
      label: 'Dżinsy',
      mesh: { model: 'casual', mesh: 'Legs', tints: [p('LightBlue')] },
    },
    {
      part: 'base:bottom-shorts',
      label: 'Szorty',
      mesh: { model: 'hoodie', mesh: 'Legs', tints: [p('LightBlue')] },
    },
    {
      part: 'base:bottom-work-pants',
      label: 'Robocze',
      mesh: { model: 'worker', mesh: 'Legs', tints: [p('Brown2'), p('Brown', 0.78)] },
    },
  ],
  shoes: [
    {
      part: 'base:shoes-sneakers',
      label: 'Trampki',
      mesh: { model: 'casual', mesh: 'Feet', tints: [p('Red_Dark'), s('White')] },
    },
    {
      part: 'base:shoes-hiking',
      label: 'Półbuty',
      mesh: { model: 'hoodie', mesh: 'Feet', tints: [p('Purple'), s('White')] },
    },
    {
      part: 'base:shoes-work-boots',
      label: 'Robocze',
      mesh: { model: 'worker', mesh: 'Feet', tints: [p('Black'), s('Grey')] },
    },
  ],
};

/** Hex colors for one rendered part. */
export interface PartColors {
  primary?: string;
  secondary?: string;
}

/** What the 3D builder needs: skin hex and one mesh per body part with its colors. */
export interface RenderLook {
  skin: string;
  parts: readonly { ref: MeshRef; colors: PartColors }[];
}

/** Skin materials (`Skin`, `Skin_Darker` slightly darker). */
export function skinMul(material: string): number | undefined {
  if (material === 'Skin') return 1;
  if (material === 'Skin_Darker') return 0.85;
  return undefined;
}

export const headPreset = (id: string): HeadPreset =>
  HEAD_PRESETS.find((h) => h.id === id) ?? HEAD_PRESETS[0]!;

export const clothOption = (slot: ClothSlot, part: string): ClothOption =>
  CLOTH_OPTIONS[slot].find((o) => o.part === part) ?? CLOTH_OPTIONS[slot][0]!;

/** Head preset of a created character's parts (either content scheme); first preset if unknown. */
export function presetOfParts(parts: Readonly<Record<string, { part: string }>>): HeadPreset {
  const head = parts.head?.part;
  const face = parts.face?.part;
  const hair = parts.hair?.part;
  return (
    HEAD_PRESETS.find((h) => (head ? h.head === head : h.face === face && h.hairPart === hair)) ??
    HEAD_PRESETS.find((h) => h.face === face) ??
    HEAD_PRESETS[0]!
  );
}

/**
 * Render look from a resolved appearance (the sim's `characterProfile.appearance`, colors as
 * palette color ids) and a palette lookup (`base:skin` + id → hex).
 */
export function lookFromAppearance(
  appearance: {
    skin: string;
    parts: Readonly<Record<string, { part: string; colors: PartColors }>>;
  },
  hex: (palette: string, color: string | undefined) => string | undefined,
): RenderLook {
  const head = presetOfParts(appearance.parts);
  const hairColor = (appearance.parts.head ?? appearance.parts.hair)?.colors.primary;
  const hairHex = hex('base:hair', hairColor);
  const parts: { ref: MeshRef; colors: PartColors }[] = [
    { ref: head.mesh, colors: hairHex ? { primary: hairHex } : {} },
  ];
  for (const slot of ['top', 'bottom', 'shoes'] as const) {
    const choice = appearance.parts[slot];
    const opt = clothOption(slot, choice?.part ?? '');
    const c: PartColors = {};
    const pr = hex('base:cloth', choice?.colors.primary);
    const se = hex('base:cloth', choice?.colors.secondary);
    if (pr) c.primary = pr;
    if (se) c.secondary = se;
    parts.push({ ref: opt.mesh, colors: c });
  }
  return { skin: hex('base:skin', appearance.skin) ?? '#d9ad8a', parts };
}
