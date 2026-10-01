import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { buildAll, loadPacks } from './build.js';
import { checkManifestLicences, updateAssetsMd, type AssetManifest } from './manifest.js';
import { ALLOWED_LICENCES } from './pack.js';
import { renderIcons } from './icons.js';

const toolDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(toolDir, '../..');
const paths = {
  packsDir: join(toolDir, 'packs'),
  cacheDir: join(toolDir, '.cache'),
  outDir: join(repo, 'apps/game/public/models'),
};

/** Icon size in px (UI slots are ≤ 64 px; 2× for HiDPI). */
const ICON_SIZE = 128;

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

function report(m: AssetManifest): void {
  let before = 0;
  let after = 0;
  for (const a of m.assets) {
    const lod0 = a.lods[0]!;
    before += a.sourceBytes;
    after += lod0.bytes;
    const lodInfo = a.lods.map((l) => `${l.triangles}△ ${kb(l.bytes)}`).join(' | ');
    console.log(`${a.id}: ${kb(a.sourceBytes)} → ${lodInfo}`);
  }
  const all = m.assets.flatMap((a) => a.lods).reduce((s, l) => s + l.bytes, 0);
  const pal = m.packs.reduce((s, p) => s + (p.palette?.bytes ?? 0), 0);
  console.log(`LOD0 razem: ${kb(before)} → ${kb(after)}; wszystkie LOD + palety: ${kb(all + pal)}`);
}

async function check(): Promise<void> {
  await loadPacks(paths.packsDir); // throws on missing / disallowed licence
  const m = JSON.parse(
    await readFile(join(paths.outDir, 'manifest.json'), 'utf8'),
  ) as AssetManifest;
  const problems = checkManifestLicences(m, ALLOWED_LICENCES);
  const files = [
    ...m.assets.flatMap((a) => a.lods.map((l) => l.file)),
    ...m.packs.flatMap((p) => (p.palette ? [p.palette.file] : [])),
  ];
  for (const f of files)
    await stat(join(paths.outDir, f)).catch(() => problems.push(`brak pliku ${f}`));
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(
    `OK: ${m.packs.length} pack(i), ${m.assets.length} assetów, licencje ${ALLOWED_LICENCES.join(', ')}`,
  );
}

async function main(cmd = 'build'): Promise<void> {
  if (cmd === 'check') return check();
  if (cmd === 'icons') {
    return renderIcons({
      toolDir,
      outDir: join(repo, 'apps/game/public/icons'),
      size: Number(process.argv[3] ?? ICON_SIZE),
    });
  }
  if (cmd !== 'build') throw new Error('Użycie: assets build|check|icons [rozmiar]');
  const m = await buildAll(paths);
  const md = join(repo, 'ASSETS.md');
  const current = await readFile(md, 'utf8').catch(() => '');
  const opts = (await resolveConfig(md)) ?? {};
  await writeFile(md, await format(updateAssetsMd(current, m), { ...opts, parser: 'markdown' }));
  report(m);
}

main(process.argv[2]).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
