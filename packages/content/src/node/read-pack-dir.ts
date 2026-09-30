import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { PackSource } from '../validate/pack-source.js';

/** Czyta katalog paczki z dysku jako `PackSource` (wszystkie pliki `.json`, rekurencyjnie). */
export async function readPackDir(dir: string): Promise<PackSource> {
  const files: PackSource['files'] = [];
  for (const abs of await listJsonFiles(dir)) {
    files.push({
      path: relative(dir, abs).split(sep).join('/'),
      text: await readFile(abs, 'utf8'),
    });
  }
  return { dir, files };
}

async function listJsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.')) out.push(...(await listJsonFiles(full)));
    else if (e.isFile() && e.name.endsWith('.json')) out.push(full);
  }
  return out;
}
