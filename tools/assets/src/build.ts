import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { fetchPack } from './fetch.js';
import {
  buildManifest,
  packEntry,
  paletteMaterialName,
  type AssetManifest,
  type ManifestAsset,
  type ManifestLod,
  type ManifestPack,
} from './manifest.js';
import { countTriangles, optimize, ready } from './optimize.js';
import { parsePack, type Pack } from './pack.js';
import { encodeTexture } from './texture.js';

/** LOD level kept only if it has at most this fraction of the previous level's triangles. */
const MIN_LOD_GAIN = 0.85;

export interface BuildPaths {
  packsDir: string;
  cacheDir: string;
  outDir: string;
}

export async function createIO(): Promise<NodeIO> {
  await ready();
  await MeshoptDecoder.ready;
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.WARN))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

export async function loadPacks(packsDir: string): Promise<Pack[]> {
  const files = (await readdir(packsDir)).filter((f) => f.endsWith('.json')).sort();
  const packs: Pack[] = [];
  for (const f of files) {
    packs.push(parsePack(JSON.parse(await readFile(join(packsDir, f), 'utf8')), f));
  }
  return packs;
}

async function buildPack(io: NodeIO, pack: Pack, paths: BuildPaths) {
  const src = join(await fetchPack(pack, paths.cacheDir), pack.root);
  const out = join(paths.outDir, pack.id);
  await mkdir(out, { recursive: true });
  let palette: ManifestPack['palette'];
  if (pack.palette) {
    const png = await readFile(join(src, pack.palette.image));
    const enc = pack.palette.encoding;
    const file = `${pack.id}/palette.${enc === 'png' ? 'png' : 'ktx2'}`;
    const data = await encodeTexture(png, enc);
    await writeFile(join(paths.outDir, file), data);
    palette = {
      material: paletteMaterialName(pack.id),
      file,
      bytes: data.byteLength,
      sourceBytes: png.byteLength,
    };
  }
  const paletteMaterial = palette?.material;
  const levels = [
    { ratio: 1, distance: 0 },
    ...(pack.lod?.ratios ?? []).map((ratio, i) => ({ ratio, distance: pack.lod!.distances[i]! })),
  ];
  const assets: ManifestAsset[] = [];
  for (const model of pack.models) {
    const input = join(src, `${model}.glb`);
    const lods: ManifestLod[] = [];
    for (const [i, lvl] of levels.entries()) {
      const doc = await optimize(await io.read(input), { paletteMaterial, ratio: lvl.ratio });
      const triangles = countTriangles(doc);
      // A level that barely simplifies (low-poly, UV seams) is not worth a file and a draw switch.
      if (i > 0 && triangles > MIN_LOD_GAIN * lods[lods.length - 1]!.triangles) continue;
      const glb = await io.writeBinary(doc);
      const file = `${pack.id}/${model}${i === 0 ? '' : `.lod${lods.length}`}.glb`;
      await writeFile(join(paths.outDir, file), glb);
      lods.push({ file, distance: lvl.distance, bytes: glb.byteLength, triangles });
    }
    assets.push({
      id: `${pack.id}/${model}`,
      pack: pack.id,
      sourceBytes: (await stat(input)).size,
      lods,
    });
  }
  return { entry: packEntry(pack, palette), assets };
}

export async function buildAll(paths: BuildPaths): Promise<AssetManifest> {
  const io = await createIO();
  const packs: ManifestPack[] = [];
  const assets: ManifestAsset[] = [];
  for (const pack of await loadPacks(paths.packsDir)) {
    const r = await buildPack(io, pack, paths);
    packs.push(r.entry);
    assets.push(...r.assets);
  }
  const manifest = buildManifest(packs, assets);
  await writeFile(join(paths.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
