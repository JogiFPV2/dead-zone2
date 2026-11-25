import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Object3D } from 'three';
import {
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Matrix4,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Texture,
} from 'three';
import type { FarmPlotView } from '@deadzone/protocol';
import { simToWorld } from '../sim/coords.js';

/**
 * Dug plots (farming, `view.farmPlots`): a bed of dark, furrowed soil on the tile and up to four
 * plants on it, drawn from flat-shaded low-poly pieces in the painted palette. `stage` 1 seeds
 * (bare soil with specks), 2 sprouts, 3 young plants, 4 ripe (the crop shows: tomatoes, carrot
 * tops, a cabbage head …). Dry soil is paler, wilted plants droop and fade, dead ones are brown.
 */

/** Soil bed: slightly smaller than the tile, a few cm high. */
const BED_SIZE = 0.9;
const BED_H = 0.05;
/** Plants are drawn a bit larger than life so they read from the game camera. */
const PLANT_SCALE = 1.5;

/** Plant spots on the bed (tile-local metres from the centre). */
const SPOTS: readonly [number, number][] = [
  [-0.2, -0.2],
  [0.2, -0.2],
  [-0.2, 0.2],
  [0.2, 0.2],
];

const C = {
  leaf: 0x5e8c3a,
  leafLight: 0x86ad4f,
  leafDark: 0x3f6a2c,
  wilt: 0x9a9a4e,
  dead: 0x7d6847,
  stem: 0x6b8a3a,
  stake: 0x8a6a45,
  red: 0xc8453c,
  orange: 0xe08a3a,
  cabbage: 0xa9c98a,
  onion: 0xe8dcc0,
  cucumber: 0x3f7a35,
  pod: 0x6aa045,
  strawberry: 0xd23a3a,
  flower: 0xf1ecd8,
  potatoFlower: 0xb59ad6,
  seed: 0xd8c79a,
} as const;

const materials = new Map<number, MeshStandardMaterial>();
const mat = (color: number): MeshStandardMaterial => {
  let m = materials.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
    materials.set(color, m);
  }
  return m;
};

const G = {
  bed: new BoxGeometry(BED_SIZE, BED_H, BED_SIZE),
  leaf: new IcosahedronGeometry(1, 0),
  blade: new ConeGeometry(1, 1, 4),
  ball: new SphereGeometry(1, 7, 5),
  stake: new CylinderGeometry(0.012, 0.015, 1, 5),
};

/** Painted furrows on the soil (rows along x), made once. */
let soilTex: Texture | undefined;
function soilTexture(): Texture | undefined {
  if (soilTex || typeof document === 'undefined') return soilTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return undefined;
  g.fillStyle = '#5a3f28';
  g.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 4; row++) {
    const y = 8 + row * 16;
    g.fillStyle = '#3e2a1a';
    g.fillRect(0, y - 3, 64, 5);
    g.fillStyle = '#74553a';
    g.fillRect(0, y + 3, 64, 3);
  }
  // Brush-like speckle (deterministic).
  for (let i = 0; i < 120; i++) {
    const h = Math.sin(i * 91.7) * 43758.5453;
    const r = h - Math.floor(h);
    const x = (i * 37) % 64;
    const y = Math.floor(r * 64);
    g.fillStyle = r > 0.5 ? 'rgba(120,90,60,0.6)' : 'rgba(40,28,18,0.5)';
    g.fillRect(x, y, 2, 1);
  }
  soilTex = new CanvasTexture(c);
  soilTex.colorSpace = SRGBColorSpace;
  soilTex.wrapS = soilTex.wrapT = RepeatWrapping;
  return soilTex;
}

const soilMats = new Map<string, MeshStandardMaterial>();
function soilMaterial(dry: boolean): MeshStandardMaterial {
  const k = dry ? 'dry' : 'wet';
  let m = soilMats.get(k);
  if (!m) {
    const map = soilTexture();
    m = new MeshStandardMaterial({
      color: dry ? 0xd2b48c : 0xffffff,
      roughness: 0.95,
      ...(map ? { map } : {}),
    });
    soilMats.set(k, m);
  }
  return m;
}

function piece(
  geo: BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rotY = 0,
): Mesh {
  const m = new Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A tuft of leaves (`n` leaves around the spot), `h` tall. */
function tuft(g: Group, x: number, z: number, n: number, h: number, w: number, color: number) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + x * 3 + z * 5;
    const d = w * 0.45;
    g.add(
      piece(
        G.leaf,
        color,
        x + Math.cos(a) * d,
        h * 0.5,
        z + Math.sin(a) * d,
        w * 0.45,
        h * 0.5,
        w * 0.3,
        -a,
      ),
    );
  }
}

/** Thin upright blades (carrot / onion tops). */
function blades(g: Group, x: number, z: number, n: number, h: number, color: number) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + x * 7;
    const b = piece(
      G.blade,
      color,
      x + Math.cos(a) * 0.03,
      h / 2,
      z + Math.sin(a) * 0.03,
      0.025,
      h,
      0.025,
    );
    b.rotation.z = Math.cos(a) * 0.25;
    b.rotation.x = Math.sin(a) * 0.25;
    g.add(b);
  }
}

/** One plant of `crop` at `stage` 2..4 on spot (x, z), leaf colour `leaf`. */
function plant(
  g: Group,
  crop: string,
  stage: number,
  x: number,
  z: number,
  leaf: number,
  alive: boolean,
) {
  const s = stage === 2 ? 0.35 : stage === 3 ? 0.7 : 1;
  const ripe = stage === 4 && alive;
  switch (crop) {
    case 'carrot':
      blades(g, x, z, 6, 0.28 * s, leaf);
      if (ripe) g.add(piece(G.blade, C.orange, x, 0.01, z, 0.04, 0.05, 0.04, 0));
      break;
    case 'onion':
      blades(g, x, z, 4, 0.3 * s, leaf);
      if (ripe) g.add(piece(G.ball, C.onion, x, 0.03, z, 0.05, 0.04, 0.05));
      break;
    case 'cabbage':
      tuft(g, x, z, 5, 0.12 * s, 0.26 * s, leaf);
      if (stage >= 3)
        g.add(
          piece(G.ball, alive ? C.cabbage : leaf, x, 0.08 * s, z, 0.11 * s, 0.09 * s, 0.11 * s),
        );
      break;
    case 'tomato':
    case 'beans': {
      if (stage >= 3) g.add(piece(G.stake, C.stake, x + 0.06, 0.25, z, 1, 0.5, 1));
      tuft(g, x, z, 5, 0.34 * s, 0.2 * s, leaf);
      tuft(g, x, z, 4, 0.2 * s, 0.16 * s, leaf);
      if (ripe) {
        for (let i = 0; i < 4; i++) {
          const a = i * 1.7 + x * 3;
          const px = x + Math.cos(a) * 0.08;
          const pz = z + Math.sin(a) * 0.08;
          const py = 0.1 + (i % 2) * 0.12;
          g.add(
            crop === 'tomato'
              ? piece(G.ball, C.red, px, py, pz, 0.035, 0.032, 0.035)
              : piece(G.blade, C.pod, px, py, pz, 0.015, 0.1, 0.015),
          );
        }
      }
      break;
    }
    case 'cucumber':
      tuft(g, x, z, 6, 0.12 * s, 0.3 * s, leaf);
      if (ripe) g.add(piece(G.ball, C.cucumber, x + 0.08, 0.03, z, 0.08, 0.025, 0.03, x * 4));
      break;
    case 'strawberry':
      tuft(g, x, z, 6, 0.08 * s, 0.18 * s, leaf);
      if (ripe)
        for (let i = 0; i < 3; i++) {
          const a = i * 2.1 + z * 3;
          g.add(
            piece(
              G.blade,
              C.strawberry,
              x + Math.cos(a) * 0.09,
              0.02,
              z + Math.sin(a) * 0.09,
              0.022,
              -0.035,
              0.022,
            ),
          );
        }
      break;
    default: {
      // Potato and anything unknown: a leafy bush, flowers when ripe.
      tuft(g, x, z, 6, 0.26 * s, 0.24 * s, leaf);
      if (ripe)
        for (let i = 0; i < 3; i++) {
          const a = i * 2.3 + x * 5;
          g.add(
            piece(
              G.ball,
              i === 1 ? C.flower : C.potatoFlower,
              x + Math.cos(a) * 0.07,
              0.27,
              z + Math.sin(a) * 0.07,
              0.022,
              0.018,
              0.022,
            ),
          );
        }
    }
  }
}

const plantMaterial = new MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.9,
  flatShading: true,
});

/**
 * Bakes the pieces under `g` (positions, scales, colours) into one mesh with vertex colours:
 * one draw call per plot instead of one per leaf.
 */
function bake(g: Object3D): Mesh | undefined {
  g.updateMatrixWorld(true);
  const inv = new Matrix4().copy(g.matrixWorld).invert();
  const parts: BufferGeometry[] = [];
  const col = new Color();
  g.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const geo = (o.geometry as BufferGeometry).clone();
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    if (nonIndexed !== geo) geo.dispose();
    nonIndexed.applyMatrix4(new Matrix4().multiplyMatrices(inv, o.matrixWorld));
    col.copy((o.material as MeshStandardMaterial).color);
    const n = nonIndexed.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
    }
    nonIndexed.setAttribute('color', new Float32BufferAttribute(c, 3));
    for (const name of Object.keys(nonIndexed.attributes))
      if (name !== 'position' && name !== 'normal' && name !== 'color')
        nonIndexed.deleteAttribute(name);
    parts.push(nonIndexed);
  });
  if (parts.length === 0) return undefined;
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) return undefined;
  const m = new Mesh(merged, plantMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** The whole plot model (bed + plants), its origin at the tile centre on the ground. */
export function plotModel(p: FarmPlotView): Group {
  const g = new Group();
  const bed = new Mesh(
    G.bed,
    soilMaterial(p.crop !== undefined && p.water !== 'wet' && p.water !== 'dead'),
  );
  bed.position.y = BED_H / 2 - 0.02;
  bed.receiveShadow = true;
  g.add(bed);
  if (!p.crop || p.stage === 0) return g;
  const top = BED_H - 0.02;
  const plants = new Group();
  plants.position.y = top;
  const baked = new Group();
  baked.add(plants);
  if (p.stage === 1) {
    // Seeds just sown: pale specks along the furrows.
    for (const [x, z] of SPOTS) plants.add(piece(G.ball, C.seed, x, 0.005, z, 0.025, 0.012, 0.025));
    const m = bake(baked);
    if (m) g.add(m);
    return g;
  }
  const alive = p.water !== 'dead';
  const leaf = !alive
    ? C.dead
    : p.water === 'wilted'
      ? C.wilt
      : p.stage === 2
        ? C.leafLight
        : C.leaf;
  const one = p.crop === 'cabbage' && p.stage >= 3;
  for (const [x, z] of one ? [[0, 0] as [number, number]] : SPOTS)
    plant(plants, p.crop, p.stage, x, z, leaf, alive);
  // Wilted / dead plants droop.
  if (p.water === 'wilted') plants.scale.y = 0.75;
  if (!alive) plants.scale.y = 0.45;
  plants.scale.x = plants.scale.z = PLANT_SCALE;
  plants.scale.y *= PLANT_SCALE;
  const m = bake(baked);
  if (m) g.add(m);
  return g;
}

const sigOf = (p: FarmPlotView): string => `${p.crop ?? ''}|${p.stage}|${p.water}`;

export class FarmPlots {
  readonly root = new Group();
  private readonly plots = new Map<string, { g: Group; sig: string }>();
  private last: readonly FarmPlotView[] | undefined;

  constructor() {
    this.root.name = 'farm-plots';
  }

  update(list: readonly FarmPlotView[]): void {
    if (list === this.last) return;
    this.last = list;
    const seen = new Set<string>();
    for (const p of list) {
      const key = `${p.x},${p.y},${p.z}`;
      seen.add(key);
      const sig = sigOf(p);
      const cur = this.plots.get(key);
      if (cur?.sig === sig) continue;
      if (cur) this.root.remove(cur.g);
      const g = plotModel(p);
      const w = simToWorld(p.x + 0.5, p.y + 0.5, p.z);
      g.position.set(w.x, w.y, w.z);
      g.name = `plot ${key}`;
      this.root.add(g);
      this.plots.set(key, { g, sig });
    }
    for (const [key, cur] of this.plots) {
      if (seen.has(key)) continue;
      this.root.remove(cur.g);
      this.plots.delete(key);
    }
  }

  /** Plot models by `x,y,z` (tests). */
  modelOf(key: string): Group | undefined {
    return this.plots.get(key)?.g;
  }
}
