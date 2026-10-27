/**
 * Designer's building palette (`docs/design/look-palette.json`, look-spec.md §B,
 * 27.10.2026): wall / roof sRGB hex per type, weights of the walls. Data only — replace from the
 * JSON when it changes.
 */
export type BldType =
  'block' | 'house' | 'service' | 'industrial' | 'public' | 'outbuilding' | 'kamienica';
export interface BldTypePalette {
  walls: readonly string[];
  weights: readonly number[];
  roofs: readonly string[];
}
export const BLD_PALETTE: Readonly<Record<BldType, BldTypePalette>> = {
  block: {
    walls: ['#d9d2c3', '#c9d3cf', '#e0cfa9', '#c7c2d0', '#d6b8a6', '#bfcab2'],
    weights: [0.25, 0.18, 0.18, 0.12, 0.15, 0.12],
    roofs: ['#5a5c5e', '#6b6d6a', '#4c4e50'],
  },
  house: {
    walls: ['#e6dcc6', '#e8d9a8', '#efebe3', '#bdb8ae', '#d8c09a', '#cfc6b4'],
    weights: [0.24, 0.18, 0.18, 0.14, 0.14, 0.12],
    roofs: ['#8e3b2c', '#6e3426', '#5a4434', '#3c3f42', '#2f3132'],
  },
  service: {
    walls: ['#d7d3cb', '#b9bcbc', '#cfc2a4', '#c6cfd4', '#a9a397'],
    weights: [0.3, 0.2, 0.2, 0.15, 0.15],
    roofs: ['#4c4e50', '#6b6d6a', '#3a3c3e'],
  },
  industrial: {
    walls: ['#9aa0a3', '#b4b2a8', '#8a8f86', '#a5998a', '#7f878c'],
    weights: [0.3, 0.2, 0.2, 0.15, 0.15],
    roofs: ['#6f7376', '#5f615c', '#7a5a45'],
  },
  public: {
    walls: ['#e4dcc8', '#d9c7a3', '#9e5a45', '#cdd0cc', '#b8a690'],
    weights: [0.3, 0.2, 0.2, 0.15, 0.15],
    roofs: ['#8e3b2c', '#3c3f42', '#4f6a5c', '#6b6d6a'],
  },
  outbuilding: {
    walls: ['#8b7a63', '#a8a196', '#6f6656', '#b7aa8e', '#7f8a7a'],
    weights: [0.25, 0.25, 0.2, 0.15, 0.15],
    roofs: ['#2f3132', '#5f615c', '#6b4731', '#7a5a45'],
  },
  /** Tenement (look-spec.md §B table; not in the JSON). Equal-ish weights. */
  kamienica: {
    walls: ['#d8c49a', '#c9b08a', '#e2d6bd', '#b9a48a', '#cdbfa8'],
    weights: [0.25, 0.2, 0.2, 0.15, 0.2],
    roofs: ['#8e3b2c', '#5a4434', '#3c3f42'],
  },
};
