import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import {
  CARD_CATEGORIES,
  CARD_GRID,
  CARD_VARIANTS,
  DETAIL_CARD,
  type CardCategory,
  type DetailCard,
} from './window-card.js';

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
 * Card atlas (`CARD_GRID`²) painted on a canvas (no asset to load). Each cell: back wall, a floor
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
  for (const [name, cell] of Object.entries(DETAIL_CARD) as [DetailCard, number][]) {
    const x0 = (cell % CARD_GRID) * PX;
    const y0 = (CARD_GRID - 1 - Math.floor(cell / CARD_GRID)) * PX;
    g.save();
    g.beginPath();
    g.rect(x0, y0, PX, PX);
    g.clip();
    g.translate(x0, y0);
    paintDetail(g, name, cell);
    g.restore();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.name = 'window-card-atlas';
  return t;
}

/** Small deterministic noise for the painted cells (no Math.random). */
function rnd(seed: number): () => number {
  let h = seed >>> 0 || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function sign(g: CanvasRenderingContext2D, text: string, bg: string, fg: string): void {
  g.fillStyle = bg;
  g.fillRect(0, PX * 0.3, PX, PX * 0.4);
  g.strokeStyle = fg;
  g.lineWidth = 3;
  g.strokeRect(3, PX * 0.3 + 3, PX - 6, PX * 0.4 - 6);
  g.fillStyle = fg;
  g.font = `bold ${Math.round(PX * (text.length > 6 ? 0.17 : 0.22))}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, PX / 2, PX / 2 + 1);
}

/** One bld detail cell (look-spec §D), in cell pixels (0..PX, y down). */
function paintDetail(g: CanvasRenderingContext2D, name: DetailCard, seed: number): void {
  const r = rnd(seed * 2654435761);
  switch (name) {
    case 'broken':
    case 'broken2': {
      // Dark hole with a few shards left in the frame.
      g.fillStyle = '#111315';
      g.fillRect(0, 0, PX, PX);
      g.fillStyle = 'rgba(160,185,196,0.55)';
      const shards = name === 'broken' ? 2 : 1;
      for (let i = 0; i < shards; i++) {
        const cx = i === 0 ? 0 : PX;
        const cy = r() < 0.5 ? 0 : PX;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + (cx ? -1 : 1) * PX * (0.3 + r() * 0.4), cy);
        g.lineTo(cx, cy + (cy ? -1 : 1) * PX * (0.3 + r() * 0.4));
        g.fill();
      }
      return;
    }
    case 'boarded':
    case 'boarded2': {
      g.fillStyle = '#1a1714';
      g.fillRect(0, 0, PX, PX);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const y = (i + 0.2) * (PX / n);
        g.save();
        g.translate(PX / 2, y + PX / n / 3);
        g.rotate((name === 'boarded2' ? 1 : -1) * (r() - 0.5) * 0.25);
        g.fillStyle = ['#8a6a48', '#7a5c3e', '#94754f'][i]!;
        g.fillRect(-PX * 0.55, -PX * 0.12, PX * 1.1, PX * 0.24);
        g.fillStyle = '#3a2d20';
        g.fillRect(-PX * 0.45, -2, 4, 4);
        g.fillRect(PX * 0.42, -2, 4, 4);
        g.restore();
      }
      return;
    }
    case 'dirty':
      g.fillStyle = '#4a4e48';
      g.fillRect(0, 0, PX, PX);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(90,80,60,${0.15 + r() * 0.3})`;
        g.fillRect(r() * PX, r() * PX, 6 + r() * 20, 4 + r() * 12);
      }
      return;
    case 'signSchool':
      sign(g, 'SZKOŁA', '#efe9df', '#1f3f7a');
      return;
    case 'signPolice':
      sign(g, 'POLICJA', '#1f4e9c', '#ffffff');
      return;
    case 'signHospital':
      sign(g, 'SZPITAL', '#ffffff', '#c0272d');
      return;
    case 'signSor':
      sign(g, 'SOR', '#c0272d', '#ffffff');
      return;
    case 'cross':
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, PX, PX);
      g.fillStyle = '#c0272d';
      g.fillRect(PX * 0.38, PX * 0.12, PX * 0.24, PX * 0.76);
      g.fillRect(PX * 0.12, PX * 0.38, PX * 0.76, PX * 0.24);
      return;
    case 'star': {
      g.fillStyle = '#1f4e9c';
      g.fillRect(0, 0, PX, PX);
      g.fillStyle = '#e8c547';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? PX * 0.18 : PX * 0.42;
        g.lineTo(PX / 2 + Math.cos(a) * rr, PX / 2 + Math.sin(a) * rr);
      }
      g.fill();
      return;
    }
    case 'stripePolice':
      g.fillStyle = '#1f4e9c';
      g.fillRect(0, 0, PX, PX);
      g.fillStyle = '#e8e6e0';
      g.fillRect(0, PX * 0.08, PX, PX * 0.06);
      g.fillRect(0, PX * 0.86, PX, PX * 0.06);
      return;
    case 'bandSchool':
      g.fillStyle = '#d0a45a';
      g.fillRect(0, 0, PX, PX);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, PX * 0.85, PX, PX * 0.15);
      return;
    case 'roofHole':
    case 'roofHole2': {
      // Torn felt edge around a dark hole with a rafter showing.
      g.fillStyle = '#2b2a28';
      g.beginPath();
      const k = name === 'roofHole' ? 9 : 7;
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        const rr = PX * (0.32 + r() * 0.16);
        g.lineTo(PX / 2 + Math.cos(a) * rr, PX / 2 + Math.sin(a) * rr);
      }
      g.fill();
      g.fillStyle = '#0c0c0d';
      g.beginPath();
      g.arc(PX / 2, PX / 2, PX * 0.26, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#6b5236';
      g.fillRect(PX * 0.2, PX * 0.46, PX * 0.6, PX * 0.08);
      return;
    }
    case 'graffiti0':
    case 'graffiti1':
    case 'graffiti2':
    case 'graffiti3': {
      const i = Number(name.slice(-1));
      const col = ['#d23c8a', '#2f9e5a', '#e0a020', '#3a6ad0'][i]!;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = '#151515';
      g.lineWidth = 16;
      const tag = ['DZ', 'GKS', 'STW', '1993'][i]!;
      g.font = `italic bold ${Math.round(PX * 0.42)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeText(tag, PX / 2, PX / 2);
      g.fillStyle = col;
      g.fillText(tag, PX / 2, PX / 2);
      return;
    }
    case 'plasterLoss': {
      // Bricks under fallen plaster (Bricks059 tone), ragged edge.
      g.fillStyle = '#9e5a45';
      g.fillRect(0, 0, PX, PX);
      g.fillStyle = '#c9bfae';
      for (let y = 0; y < PX; y += 10) g.fillRect(0, y, PX, 2);
      for (let y = 0; y < PX; y += 10)
        for (let x = (y / 10) % 2 ? 0 : 12; x < PX; x += 24) g.fillRect(x, y, 2, 10);
      return;
    }
    case 'streaks':
      for (let i = 0; i < 14; i++) {
        const x = r() * PX;
        const w = 3 + r() * 8;
        const h = PX * (0.4 + r() * 0.6);
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, 'rgba(40,36,30,0.9)');
        gr.addColorStop(1, 'rgba(40,36,30,0)');
        g.fillStyle = gr;
        g.fillRect(x, 0, w, h);
      }
      return;
  }
}
