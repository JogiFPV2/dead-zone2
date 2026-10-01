import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import type { Pack } from './pack.js';

/**
 * Downloads the pack zip into `cacheDir` (once), verifies sha256, extracts it to
 * `cacheDir/<id>/` and returns that directory.
 */
export async function fetchPack(pack: Pack, cacheDir: string): Promise<string> {
  if (pack.files) return fetchFiles(pack, pack.files, cacheDir);
  if (!pack.download || !pack.sha256) throw new Error(`${pack.id}: brak download/sha256`);
  const zipPath = join(cacheDir, `${pack.id}.zip`);
  let zip: Uint8Array;
  try {
    zip = await readFile(zipPath);
  } catch {
    const res = await fetch(pack.download);
    if (!res.ok) throw new Error(`${pack.id}: pobieranie ${res.status} ${pack.download}`);
    zip = new Uint8Array(await res.arrayBuffer());
    await mkdir(dirname(zipPath), { recursive: true });
    await writeFile(zipPath, zip);
  }
  const sha = createHash('sha256').update(zip).digest('hex');
  if (sha !== pack.sha256) throw new Error(`${pack.id}: sha256 ${sha} ≠ ${pack.sha256}`);
  const dir = join(cacheDir, pack.id);
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    if (name.endsWith('/') || name.includes('..')) continue;
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), data);
  }
  return dir;
}

/** Single-file packs: each file cached under `cacheDir/<id>/<root>/<name>` and sha-checked. */
async function fetchFiles(
  pack: Pack,
  files: NonNullable<Pack['files']>,
  cacheDir: string,
): Promise<string> {
  const dir = join(cacheDir, pack.id);
  for (const f of files) {
    const path = join(dir, pack.root, f.name);
    let data: Uint8Array;
    try {
      data = await readFile(path);
    } catch {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`${pack.id}: pobieranie ${res.status} ${f.url}`);
      data = new Uint8Array(await res.arrayBuffer());
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    }
    const sha = createHash('sha256').update(data).digest('hex');
    if (sha !== f.sha256) throw new Error(`${pack.id}/${f.name}: sha256 ${sha} ≠ ${f.sha256}`);
  }
  return dir;
}
