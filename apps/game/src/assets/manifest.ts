/**
 * `assets/manifest.json` written by `@deadzone/assets` (tools/assets). Mirrored here with a small
 * manual validator: the game has no direct zod dependency.
 */
export interface ManifestLod {
  file: string;
  distance: number;
  bytes: number;
  triangles: number;
}

/** Three 13-layer KTX2 arrays + layers.json (paths relative to apps/game/public). */
export interface ManifestPbrSet {
  albedo: string;
  normal: string;
  orm: string;
}

export interface ManifestPbrMaps extends ManifestPbrSet {
  layers: string;
  /** 512 set for the low preset (medium / high use the 1024 set above). */
  lowRes?: ManifestPbrSet;
}

export interface ManifestAsset {
  id: string;
  pack: string;
  sourceBytes: number;
  lods: ManifestLod[];
  /** `pbr` = realistic-style model (`*.pbr.glb` next to the file); absent = `vc` (today). */
  material?: 'pbr';
  pbr?: ManifestPbrMaps;
  /** Uniform scale to metres of the PBR model (e.g. Kenney sedan 1.69). */
  scale?: number;
}

export interface ManifestPack {
  id: string;
  name: string;
  author: string;
  licence: string;
  licenceUrl: string;
  source: string;
  palette?: { material: string; file: string; bytes: number; sourceBytes: number };
}

export interface AssetManifest {
  version: 1;
  packs: ManifestPack[];
  assets: ManifestAsset[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (o: Obj, k: string, at: string): string => {
  if (typeof o[k] !== 'string' || !o[k]) throw new Error(`manifest ${at}.${k}: oczekiwano tekstu`);
  return o[k];
};
const num = (o: Obj, k: string, at: string): number => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new Error(`manifest ${at}.${k}: oczekiwano liczby ≥ 0`);
  }
  return v;
};
const arr = (o: Obj, k: string, at: string): Obj[] => {
  const v = o[k];
  if (!Array.isArray(v) || !v.every(isObj))
    throw new Error(`manifest ${at}.${k}: oczekiwano listy`);
  return v;
};

function parsePack(p: Obj, at: string): ManifestPack {
  const pack: ManifestPack = {
    id: str(p, 'id', at),
    name: str(p, 'name', at),
    author: str(p, 'author', at),
    licence: str(p, 'licence', at),
    licenceUrl: str(p, 'licenceUrl', at),
    source: str(p, 'source', at),
  };
  if (p.palette !== undefined) {
    if (!isObj(p.palette)) throw new Error(`manifest ${at}.palette: oczekiwano obiektu`);
    const q = p.palette;
    const a = `${at}.palette`;
    pack.palette = {
      material: str(q, 'material', a),
      file: str(q, 'file', a),
      bytes: num(q, 'bytes', a),
      sourceBytes: num(q, 'sourceBytes', a),
    };
  }
  return pack;
}

const PUBLIC_PATH = /^(?![a-z]+:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+\.(ktx2|json)$/i;
const path = (o: Obj, k: string): string | undefined =>
  typeof o[k] === 'string' && PUBLIC_PATH.test(o[k]) ? o[k] : undefined;

function parseSet(v: unknown): ManifestPbrSet | undefined {
  if (!isObj(v)) return undefined;
  const albedo = path(v, 'albedo');
  const normal = path(v, 'normal');
  const orm = path(v, 'orm');
  return albedo && normal && orm ? { albedo, normal, orm } : undefined;
}

/**
 * `material` / `pbr` / `scale` (realistic style). Tolerant: an older or broken shape is ignored
 * and the asset stays `vc`, so the current look never fails on it.
 */
export function parsePbrFields(a: Obj): Pick<ManifestAsset, 'material' | 'pbr' | 'scale'> {
  const out: Pick<ManifestAsset, 'material' | 'pbr' | 'scale'> = {};
  if (typeof a.scale === 'number' && Number.isFinite(a.scale) && a.scale > 0) out.scale = a.scale;
  if (a.material !== 'pbr') return out;
  out.material = 'pbr';
  const set = parseSet(a.pbr);
  const layers = isObj(a.pbr) ? path(a.pbr, 'layers') : undefined;
  if (set && layers) {
    const lowRes = parseSet((a.pbr as Obj).lowRes);
    out.pbr = { ...set, layers, ...(lowRes ? { lowRes } : {}) };
  }
  return out;
}

/** `foo.glb` → `foo.pbr.glb`: the realistic-style variant next to a current model. */
export const pbrVariantFile = (file: string): string =>
  file.endsWith('.pbr.glb') ? file : file.replace(/\.glb$/i, '.pbr.glb');

/**
 * File of the PBR model for one level: a built PBR asset (`pbr` data, e.g.
 * `models/deadzone-pbr/sedan.glb`, meshopt) is the model itself; otherwise the raw
 * `*.pbr.glb` next to the current file.
 */
export const pbrModelFile = (asset: Pick<ManifestAsset, 'pbr'>, file: string): string =>
  asset.pbr ? file : pbrVariantFile(file);

function parseAsset(a: Obj, at: string, packs: Set<string>): ManifestAsset {
  const asset: ManifestAsset = {
    id: str(a, 'id', at),
    pack: str(a, 'pack', at),
    sourceBytes: num(a, 'sourceBytes', at),
    lods: arr(a, 'lods', at).map((l, i) => ({
      file: str(l, 'file', `${at}.lods[${i}]`),
      distance: num(l, 'distance', `${at}.lods[${i}]`),
      bytes: num(l, 'bytes', `${at}.lods[${i}]`),
      triangles: num(l, 'triangles', `${at}.lods[${i}]`),
    })),
    ...parsePbrFields(a),
  };
  // Licence rule (PLAN.md): an asset without a licensed pack entry is refused.
  if (!packs.has(asset.pack)) throw new Error(`manifest ${asset.id}: brak packa z licencją`);
  if (asset.lods.length === 0) throw new Error(`manifest ${asset.id}: brak plików LOD`);
  for (let i = 1; i < asset.lods.length; i++) {
    if (asset.lods[i]!.distance <= asset.lods[i - 1]!.distance) {
      throw new Error(`manifest ${asset.id}: dystanse LOD muszą rosnąć`);
    }
  }
  return asset;
}

/** Validates untrusted JSON; throws with the offending path. */
export function parseManifest(json: unknown): AssetManifest {
  if (!isObj(json) || json.version !== 1) throw new Error('manifest: nieobsługiwana wersja');
  const packs = arr(json, 'packs', '').map((p, i) => parsePack(p, `packs[${i}]`));
  const ids = new Set(packs.map((p) => p.id));
  const assets = arr(json, 'assets', '').map((a, i) => parseAsset(a, `assets[${i}]`, ids));
  return { version: 1, packs, assets };
}

export function findAsset(m: AssetManifest, id: string): ManifestAsset {
  const a = m.assets.find((x) => x.id === id);
  if (!a) throw new Error(`nieznany asset ${id}`);
  return a;
}

/** Resolves a manifest-relative file against the manifest URL's directory. */
export function assetUrl(baseUrl: string, file: string): string {
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${file}`;
}
