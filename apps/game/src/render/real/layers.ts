/**
 * `layers.json` from the manifest's `pbr.layers` (Designer, STYLE.md §2): the 13 layers of the `deadzone-pbr`
 * texture arrays with their tile size in metres and mean linear albedo. Validated by hand (the
 * game has no zod).
 */
export interface PbrLayer {
  readonly index: number;
  readonly id: string;
  readonly tileMeters: number;
  readonly tint: 'tint' | 'natural';
  readonly meanLinear: readonly [number, number, number];
  readonly meanRoughness: number;
}

export interface PbrLayers {
  readonly material: string;
  readonly layers: readonly PbrLayer[];
}

/** Shader arrays are sized for this many layers (STYLE.md: a new layer is a design decision). */
export const MAX_LAYERS = 16;

/** Layer ids the engine maps to (STYLE.md §2). */
export const LAYER = {
  asfalt: 0,
  plyty: 1,
  kostka: 2,
  trawa: 3,
  ziemia: 4,
  beton: 5,
  tynk: 6,
  cegla: 7,
  papa: 8,
  blacha: 9,
  drewno: 10,
  szklo: 11,
  gladki: 12,
} as const;
export type LayerId = keyof typeof LAYER;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseLayers(json: unknown): PbrLayers {
  if (!isObj(json) || json.version !== 1 || !Array.isArray(json.layers)) {
    throw new Error('layers.json: nieobsługiwany format');
  }
  const layers = json.layers.map((l, i): PbrLayer => {
    const at = `layers.json layers[${i}]`;
    if (!isObj(l)) throw new Error(`${at}: oczekiwano obiektu`);
    const mean = l.meanLinear;
    if (l.index !== i) throw new Error(`${at}: index ${String(l.index)} ≠ ${i}`);
    if (typeof l.id !== 'string' || !l.id) throw new Error(`${at}.id: oczekiwano tekstu`);
    if (!finite(l.tileMeters) || l.tileMeters <= 0) throw new Error(`${at}.tileMeters > 0`);
    if (!Array.isArray(mean) || mean.length !== 3 || !mean.every((v) => finite(v) && v > 0)) {
      throw new Error(`${at}.meanLinear: trzy liczby > 0`);
    }
    return {
      index: i,
      id: l.id,
      tileMeters: l.tileMeters,
      tint: l.tint === 'natural' ? 'natural' : 'tint',
      meanLinear: [mean[0], mean[1], mean[2]] as [number, number, number],
      meanRoughness: finite(l.meanRoughness) ? l.meanRoughness : 0.8,
    };
  });
  if (layers.length === 0 || layers.length > MAX_LAYERS) {
    throw new Error(`layers.json: 1..${MAX_LAYERS} warstw`);
  }
  return { material: typeof json.material === 'string' ? json.material : 'deadzone-pbr', layers };
}

/** Uniform arrays: tile size (m) and mean linear albedo per layer (padded to MAX_LAYERS). */
export function layerTables(l: PbrLayers): {
  tile: Float32Array;
  mean: Float32Array;
  natural: Float32Array;
} {
  const tile = new Float32Array(MAX_LAYERS).fill(2);
  const mean = new Float32Array(MAX_LAYERS * 3).fill(0.5);
  const natural = new Float32Array(MAX_LAYERS);
  for (const x of l.layers) {
    tile[x.index] = x.tileMeters;
    mean.set(x.meanLinear, x.index * 3);
    natural[x.index] = x.tint === 'natural' ? 1 : 0;
  }
  return { tile, mean, natural };
}

/**
 * Town kit / terrain palette → STYLE.md albedo (the palette is tuned for the night look:
 * plaster ≈ 0.15 linear, the style wants ≈ 0.6): `tint` layers × `tint`, natural layers get a
 * grey of luminance × `natural` (clamped 0.55–1), albedo capped at `maxAlbedo` (STYLE.md §2).
 */
export const KIT_LIFT = { tint: 4, natural: 25, maxAlbedo: 0.75 } as const;
