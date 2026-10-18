import type { PbrMaps } from './material.js';
import type { Pack } from './pack.js';

export const MANIFEST_VERSION = 1;

export interface ManifestLod {
  /** Relative to the manifest directory. */
  file: string;
  /** Camera distance where this level starts (0 for the full model). */
  distance: number;
  bytes: number;
  triangles: number;
}

export interface ManifestAsset {
  /** `<pack>/<model>`. */
  id: string;
  pack: string;
  sourceBytes: number;
  lods: ManifestLod[];
  /** Only for `pbr` models (absent = `vc`, today's vertex colours / palette). */
  material?: 'pbr';
  /** PBR maps, paths relative to `apps/game/public`. */
  pbr?: PbrMaps;
}

export interface ManifestPack {
  id: string;
  name: string;
  author: string;
  licence: string;
  licenceUrl: string;
  source: string;
  /** Shared palette material: meshes whose material is named `material` get it at runtime. */
  palette?: { material: string; file: string; bytes: number; sourceBytes: number };
}

/** `assets/manifest.json`, read by the game's asset loader. */
export interface AssetManifest {
  version: typeof MANIFEST_VERSION;
  packs: ManifestPack[];
  assets: ManifestAsset[];
}

export const paletteMaterialName = (packId: string): string => `${packId}/palette`;

export function packEntry(pack: Pack, palette?: ManifestPack['palette']): ManifestPack {
  return {
    id: pack.id,
    name: pack.name,
    author: pack.author,
    licence: pack.licence,
    licenceUrl: pack.licenceUrl,
    source: pack.source,
    ...(palette ? { palette } : {}),
  };
}

/** Deterministic manifest: packs and assets sorted by id. */
export function buildManifest(packs: ManifestPack[], assets: ManifestAsset[]): AssetManifest {
  return {
    version: MANIFEST_VERSION,
    packs: [...packs].sort((a, b) => a.id.localeCompare(b.id)),
    assets: [...assets].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Every asset must belong to a pack with a licence entry. Returns problems (empty = OK). */
export function checkManifestLicences(m: AssetManifest, allowed: readonly string[]): string[] {
  const packs = new Map(m.packs.map((p) => [p.id, p]));
  const out: string[] = [];
  for (const p of m.packs) {
    if (!p.licence) out.push(`pack ${p.id}: brak licencji`);
    else if (!allowed.includes(p.licence))
      out.push(`pack ${p.id}: licencja ${p.licence} niedozwolona`);
  }
  for (const a of m.assets)
    if (!packs.has(a.pack)) out.push(`${a.id}: brak wpisu packa z licencją`);
  return out;
}

const BEGIN = '<!-- assets-pipeline:begin -->';
const END = '<!-- assets-pipeline:end -->';

/** Replaces (or appends) the generated pipeline section of ASSETS.md; the rest is untouched. */
export function updateAssetsMd(current: string, m: AssetManifest): string {
  const rows = m.packs.map((p) => {
    const n = m.assets.filter((a) => a.pack === p.id).length;
    return `| ${p.name} | ${p.author} | [${p.licence}](${p.licenceUrl}) | ${p.source} | ${n} modeli (\`apps/game/public/models/${p.id}/\`) |`;
  });
  const section = [
    BEGIN,
    '<!-- Generowane przez `pnpm --filter @deadzone/assets assets build`; nie edytuj ręcznie. -->',
    '',
    '| Pack | Autor | Licencja | Źródło | W repo |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    END,
  ].join('\n');
  const i = current.indexOf(BEGIN);
  const j = current.indexOf(END);
  if (i !== -1 && j > i) return current.slice(0, i) + section + current.slice(j + END.length);
  return `${current.trimEnd()}\n\n${section}\n`;
}
