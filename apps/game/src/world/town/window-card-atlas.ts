import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { CARD_CATEGORIES, CARD_GRID, CARD_VARIANTS, type CardCategory } from './window-card.js';

const PX = 128;
type Rect = [number, number, number, number, string];

/** Back wall, floor and silhouettes per category (x, y, w, h in 0..1 of the cell, y down). */
const LOOK: Record<CardCategory, { wall: string; floor: string; items: Rect[][] }> = {
  salon: {
    wall: '#c9b79a',
    floor: '#6b4a32',
    items: [
      [
        [0.08, 0.55, 0.5, 0.25, '#5d6b4c'],
        [0.65, 0.2, 0.25, 0.22, '#e8d9a0'],
        [0.68, 0.45, 0.2, 0.35, '#7a5a3c'],
      ],
      [
        [0.15, 0.25, 0.3, 0.2, '#8a7a5c'],
        [0.5, 0.5, 0.42, 0.3, '#7d3b32'],
        [0.1, 0.5, 0.12, 0.3, '#4a3a2a'],
      ],
    ],
  },
  kuchnia: {
    wall: '#d8d2b8',
    floor: '#8a8478',
    items: [
      [
        [0.05, 0.5, 0.9, 0.3, '#e9e6dc'],
        [0.05, 0.15, 0.55, 0.2, '#c6c0aa'],
        [0.7, 0.1, 0.22, 0.7, '#f2f2ee'],
      ],
      [
        [0.05, 0.5, 0.6, 0.3, '#b5895a'],
        [0.72, 0.2, 0.22, 0.6, '#ebebe5'],
        [0.1, 0.15, 0.4, 0.15, '#a89f86'],
      ],
    ],
  },
  sypialnia: {
    wall: '#b9c2c8',
    floor: '#5e4634',
    items: [
      [
        [0.1, 0.55, 0.6, 0.25, '#a8483c'],
        [0.1, 0.4, 0.15, 0.17, '#e6e0d0'],
        [0.75, 0.2, 0.2, 0.6, '#6e5038'],
      ],
      [
        [0.3, 0.55, 0.6, 0.25, '#4d6a8a'],
        [0.05, 0.3, 0.2, 0.5, '#7b5b40'],
        [0.4, 0.15, 0.3, 0.2, '#d6c48a'],
      ],
    ],
  },
  lazienka: {
    wall: '#cfe0e4',
    floor: '#9fb3b8',
    items: [
      [
        [0.1, 0.55, 0.55, 0.22, '#f4f4f0'],
        [0.72, 0.3, 0.2, 0.45, '#eeeeea'],
        [0.72, 0.12, 0.2, 0.15, '#9ab8c4'],
      ],
      [
        [0.08, 0.35, 0.3, 0.45, '#f0f0ec'],
        [0.5, 0.6, 0.22, 0.2, '#ffffff'],
        [0.48, 0.15, 0.26, 0.2, '#a3c2cc'],
      ],
    ],
  },
  sklep: {
    wall: '#e4e0d2',
    floor: '#8e8a80',
    items: [
      [
        [0.04, 0.12, 0.92, 0.12, '#b84a3a'],
        [0.04, 0.3, 0.92, 0.1, '#5a7a9a'],
        [0.04, 0.46, 0.92, 0.1, '#c9a24a'],
        [0.3, 0.62, 0.4, 0.2, '#6b5a48'],
      ],
      [
        [0.06, 0.15, 0.25, 0.65, '#7a7a74'],
        [0.38, 0.15, 0.25, 0.65, '#7a7a74'],
        [0.7, 0.15, 0.25, 0.65, '#7a7a74'],
        [0.06, 0.3, 0.9, 0.06, '#c25a3a'],
      ],
    ],
  },
  magazyn: {
    wall: '#8c8a84',
    floor: '#5c5a56',
    items: [
      [
        [0.08, 0.45, 0.3, 0.35, '#9a7a4e'],
        [0.42, 0.55, 0.25, 0.25, '#a8864f'],
        [0.7, 0.2, 0.22, 0.6, '#4a4e52'],
      ],
      [
        [0.05, 0.15, 0.9, 0.08, '#5a5e62'],
        [0.05, 0.5, 0.9, 0.08, '#5a5e62'],
        [0.15, 0.3, 0.2, 0.2, '#9a7a4e'],
        [0.55, 0.62, 0.25, 0.18, '#9a7a4e'],
      ],
    ],
  },
  klatka: {
    wall: '#a7b0a0',
    floor: '#6a6a64',
    items: [
      [
        [0.2, 0.3, 0.6, 0.06, '#555a52'],
        [0.3, 0.45, 0.5, 0.06, '#555a52'],
        [0.4, 0.6, 0.4, 0.06, '#555a52'],
      ],
      [
        [0.6, 0.1, 0.3, 0.7, '#6e5a44'],
        [0.1, 0.4, 0.3, 0.06, '#555a52'],
      ],
    ],
  },
  pusty: { wall: '#bab4a6', floor: '#6c6458', items: [[], [[0.6, 0.6, 0.25, 0.2, '#8a7a62']]] },
};

/**
 * 4×4 interior card atlas painted on a canvas (no asset to load). Each cell: back wall, a floor
 * band, a few furniture silhouettes and a dark falloff at the edges (depth behind the glass).
 * Undefined without a DOM (tests).
 */
export function cardAtlas(): Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX * CARD_GRID;
  const g = canvas.getContext('2d');
  if (!g) return undefined;
  CARD_CATEGORIES.forEach((cat, ci) => {
    const look = LOOK[cat];
    for (let v = 0; v < CARD_VARIANTS; v++) {
      const cell = ci * CARD_VARIANTS + v;
      const x0 = (cell % CARD_GRID) * PX;
      // Texture v runs up; canvas rows run down (flipY = true keeps row 0 at the bottom).
      const y0 = (CARD_GRID - 1 - Math.floor(cell / CARD_GRID)) * PX;
      g.fillStyle = look.wall;
      g.fillRect(x0, y0, PX, PX);
      g.fillStyle = look.floor;
      g.fillRect(x0, y0 + PX * 0.8, PX, PX * 0.2);
      for (const [x, y, w, h, c] of look.items[v] ?? []) {
        g.fillStyle = c;
        g.fillRect(x0 + x * PX, y0 + y * PX, w * PX, h * PX);
      }
      const shade = g.createRadialGradient(
        x0 + PX / 2,
        y0 + PX / 2,
        PX * 0.2,
        x0 + PX / 2,
        y0 + PX / 2,
        PX * 0.75,
      );
      shade.addColorStop(0, 'rgba(0,0,0,0.05)');
      shade.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = shade;
      g.fillRect(x0, y0, PX, PX);
    }
  });
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.name = 'window-card-atlas';
  return t;
}
