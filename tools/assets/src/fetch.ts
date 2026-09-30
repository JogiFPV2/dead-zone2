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
