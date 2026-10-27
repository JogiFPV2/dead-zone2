/**
 * Designer's building look palette (/workspace/deadzone-shots/look-palette.json v3, look-spec.md
 * §A–C): wall / roof / trim hex per type, wall weights, roof shapes, house archetypes and
 * condition weights. Data only (the `detail` key and §D are not approved yet). Single source of
 * truth: the generator writes the picked colours into the chunk building meta, the client reads them.
 */
export const LOOK_TYPES = [
  'block',
  'house',
  'service',
  'industrial',
  'public',
  'outbuilding',
  'kamienica',
  'school',
  'police',
  'hospital',
  'barn',
] as const;
export type LookType = (typeof LOOK_TYPES)[number];
export type RoofShape =
  'flat' | 'gabled' | 'hipped' | 'shed' | 'mansard' | 'gambrel' | 'barrel' | 'sawtooth';
export interface LookArchetype {
  id: string;
  weight: number;
  weightRural?: number;
  levels?: number;
  roofShape?: string;
  walls?: readonly string[];
  roofs?: readonly string[];
}
export interface LookTypePalette {
  walls: readonly string[];
  weights: readonly number[];
  roofs: readonly string[];
  trim: readonly string[];
  roofShapes: Readonly<Record<string, number>>;
  archetypes?: readonly LookArchetype[];
}
export const LOOK_PALETTE: Readonly<Record<LookType, LookTypePalette>> = {
  block: {
    walls: ['#d9d2c3', '#c9d3cf', '#e0cfa9', '#c7c2d0', '#d6b8a6', '#bfcab2'],
    weights: [0.25, 0.18, 0.18, 0.12, 0.15, 0.12],
    roofs: ['#5a5c5e', '#6b6d6a', '#4c4e50'],
    trim: ['#8b6a4e', '#7a7f84', '#6c7a5c', '#94886a', '#5b7480', '#a8704e'],
    roofShapes: { flat: 1.0 },
  },
  house: {
    walls: ['#e6dcc6', '#e8d9a8', '#efebe3', '#bdb8ae', '#d8c09a', '#cfc6b4'],
    weights: [0.24, 0.18, 0.18, 0.14, 0.14, 0.12],
    roofs: ['#8e3b2c', '#6e3426', '#5a4434', '#3c3f42', '#2f3132'],
    trim: ['#efe9df', '#6e6458', '#8a8178'],
    roofShapes: { gabled: 0.5, hipped: 0.4, flat: 0.1 },
    archetypes: [
      {
        id: 'parter-2spad',
        weight: 0.12,
        weightRural: 0.1,
        levels: 1,
        roofShape: 'gabled',
        walls: ['#e6dcc6', '#d8c09a', '#bdb8ae'],
        roofs: ['#8e3b2c', '#5a4434', '#8d8f8a'],
      },
      {
        id: 'poddasze',
        weight: 0.14,
        weightRural: 0.1,
        levels: 1.5,
        roofShape: 'gabled',
        walls: ['#efebe3', '#e8d9a8', '#cfc6b4'],
        roofs: ['#8e3b2c', '#3c3f42', '#6e3426'],
      },
      {
        id: 'kostka',
        weight: 0.16,
        weightRural: 0.14,
        levels: 2,
        roofShape: 'hipped',
        walls: ['#cfc6b4', '#bdb8ae', '#d8c09a', '#a8a196'],
        roofs: ['#5a4434', '#3c3f42', '#8d8f8a'],
      },
      {
        id: 'blizniak',
        weight: 0.08,
        weightRural: 0.02,
        levels: 2,
        roofShape: 'gabled',
        walls: ['#e6dcc6', '#c9d3cf', '#e0cfa9'],
        roofs: ['#3c3f42', '#8e3b2c'],
      },
      {
        id: 'ganek',
        weight: 0.08,
        weightRural: 0.1,
        levels: 1.5,
        roofShape: 'gabled',
        walls: ['#efe9df', '#e8d9a8', '#cfd6cf'],
        roofs: ['#6e3426', '#5a4434'],
      },
      {
        id: 'garaz',
        weight: 0.12,
        weightRural: 0.06,
        levels: 1.5,
        roofShape: 'gabled',
        walls: ['#e6dcc6', '#d6b8a6', '#efebe3'],
        roofs: ['#2f3132', '#8e3b2c'],
      },
      {
        id: 'cegla',
        weight: 0.06,
        weightRural: 0.16,
        levels: 1,
        roofShape: 'gabled',
        walls: ['#9e5a45', '#8e4a36', '#a0533c'],
        roofs: ['#8d8f8a', '#5f615c', '#6e3426'],
      },
      {
        id: 'drewniany',
        weight: 0.04,
        weightRural: 0.16,
        levels: 1,
        roofShape: 'gabled',
        walls: ['#6f5a44', '#8a6a4a', '#5a4a3a'],
        roofs: ['#5f615c', '#2f3132', '#8d8f8a'],
      },
      {
        id: 'nowoczesny',
        weight: 0.1,
        weightRural: 0.04,
        levels: 2,
        roofShape: 'flat',
        walls: ['#efebe3', '#3f4245', '#c8c0b0'],
        roofs: ['#3c3f42', '#2f3132'],
      },
      {
        id: 'willa',
        weight: 0.1,
        weightRural: 0.12,
        levels: 2,
        roofShape: 'hipped',
        walls: ['#e2d6bd', '#d8c49a', '#cfc6b4'],
        roofs: ['#8e3b2c', '#4f6a5c', '#3c3f42'],
      },
    ],
  },
  service: {
    walls: ['#d7d3cb', '#b9bcbc', '#cfc2a4', '#c6cfd4', '#a9a397'],
    weights: [0.3, 0.2, 0.2, 0.15, 0.15],
    roofs: ['#4c4e50', '#6b6d6a', '#3a3c3e'],
    trim: ['#3f5a6e', '#7d2f2a', '#4e6a4b', '#5a5a5a'],
    roofShapes: { flat: 0.85, gabled: 0.15 },
  },
  industrial: {
    walls: ['#9aa0a3', '#b4b2a8', '#8a8f86', '#a5998a', '#7f878c'],
    weights: [0.3, 0.2, 0.2, 0.15, 0.15],
    roofs: ['#6f7376', '#5f615c', '#7a5a45'],
    trim: ['#4a6b8a', '#7d6b3c', '#5b5f57'],
    roofShapes: { flat: 0.5, gabled: 0.4, sawtooth: 0.1 },
  },
  public: {
    walls: ['#e4dcc8', '#d9c7a3', '#9e5a45', '#cdd0cc', '#b8a690'],
    weights: [0.3, 0.2, 0.2, 0.15, 0.15],
    roofs: ['#8e3b2c', '#3c3f42', '#4f6a5c', '#6b6d6a'],
    trim: ['#f0ebe0', '#7a6a55', '#5a5a5a'],
    roofShapes: { gabled: 0.4, hipped: 0.3, flat: 0.3 },
  },
  outbuilding: {
    walls: ['#8b7a63', '#a8a196', '#6f6656', '#b7aa8e', '#7f8a7a'],
    weights: [0.25, 0.25, 0.2, 0.15, 0.15],
    roofs: ['#2f3132', '#5f615c', '#6b4731', '#7a5a45'],
    trim: ['#4a3f33', '#6a6a6a'],
    roofShapes: { shed: 0.5, gabled: 0.3, flat: 0.2 },
  },
  kamienica: {
    walls: ['#d8c49a', '#c9b08a', '#e2d6bd', '#b9a48a', '#cdbfa8'],
    weights: [0.3, 0.2, 0.2, 0.15, 0.15],
    roofs: ['#8e3b2c', '#5a4434', '#3c3f42'],
    trim: ['#efe9df', '#8a7a62', '#6e6458'],
    roofShapes: { gabled: 0.3, mansard: 0.2, flat: 0.5 },
  },
  school: {
    walls: ['#e4dcc8', '#d9d2c3', '#cfd6cf', '#e0cfa9', '#c8c0b0'],
    weights: [0.3, 0.2, 0.2, 0.15, 0.15],
    roofs: ['#5a5c5e', '#4c4e50'],
    trim: ['#d0a45a', '#5b7480', '#8b6a4e', '#a8704e'],
    roofShapes: { flat: 0.85, barrel: 0.15 },
  },
  police: {
    walls: ['#e8e6e0', '#cfd2d3', '#d9d3c6'],
    weights: [0.5, 0.3, 0.2],
    roofs: ['#4c4e50', '#3c3f42', '#8e3b2c'],
    trim: ['#1f4e9c', '#2a3f6e'],
    roofShapes: { flat: 0.6, hipped: 0.4 },
  },
  hospital: {
    walls: ['#e9e6dd', '#d7dcd6', '#dcd2c0', '#c9d3cf'],
    weights: [0.35, 0.25, 0.2, 0.2],
    roofs: ['#5a5c5e', '#6b6d6a'],
    trim: ['#b8312f', '#3f7f5e', '#5b7480'],
    roofShapes: { flat: 0.95, hipped: 0.05 },
  },
  barn: {
    walls: ['#6f5a44', '#8a7f72', '#5a4a3a', '#8e4a36', '#a0533c', '#9b9488'],
    weights: [0.25, 0.2, 0.15, 0.15, 0.15, 0.1],
    roofs: ['#8d8f8a', '#5f615c', '#2f3132', '#7a5a45'],
    trim: ['#3e3328', '#d8d2c4'],
    roofShapes: { gabled: 0.85, gambrel: 0.15 },
  },
};
export const CONDITION_STATES = ['ok', 'neglected', 'abandoned', 'ruin'] as const;
export type Condition = (typeof CONDITION_STATES)[number];
export const CONDITION: {
  weights: Readonly<Record<'city' | 'village' | 'industrial', Readonly<Record<Condition, number>>>>;
  /** Abandoned / ruin chance multiplier per look type (renormalised). */
  types: Readonly<Partial<Record<LookType, number>>>;
} = {
  weights: {
    city: { ok: 0.85, neglected: 0.08, abandoned: 0.05, ruin: 0.02 },
    village: { ok: 0.7, neglected: 0.13, abandoned: 0.12, ruin: 0.05 },
    industrial: { ok: 0.6, neglected: 0.18, abandoned: 0.15, ruin: 0.07 },
  },
  types: { block: 0.3, school: 0.5, police: 0.2, hospital: 0.4, barn: 1.8, outbuilding: 1.6 },
};
