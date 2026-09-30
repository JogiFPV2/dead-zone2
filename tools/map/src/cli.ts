import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BASE_PACK_DIR, readPackDir, validatePackDirs } from '@deadzone/content/node';
import { parseBlueprint } from './blueprint.js';
import { buildMap } from './build.js';
import { mapFiles, type MapFile } from './files.js';
import { formatErrors, validateSchemasOnly, validateWithPack } from './validate.js';

const USAGE = `użycie:
  map build <blueprint.json…> [--pack <katalog>] [--check] [--schema-only]
  map validate [<katalog-paczki>…]   (domyślnie paczka base)`;

// pnpm --filter runs scripts in the package dir; INIT_CWD is where the user called it.
const cwd = process.env['INIT_CWD'] ?? process.cwd();

function flag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i !== -1) args.splice(i, 1);
  return i !== -1;
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  return value;
}

/** Existing JSON files in `maps/<id>/` (for --check and stale-chunk cleanup). */
async function existing(packDir: string, id: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const dir = join(packDir, 'maps', id);
  const read = async (rel: string) => {
    try {
      out.set(rel, await readFile(join(packDir, rel), 'utf8'));
    } catch {
      /* missing */
    }
  };
  await read(`maps/${id}/manifest.json`);
  try {
    for (const f of await readdir(join(dir, 'chunks'))) {
      if (f.endsWith('.json')) await read(`maps/${id}/chunks/${f}`);
    }
  } catch {
    /* no chunks dir */
  }
  return out;
}

async function build(args: string[]): Promise<number> {
  const check = flag(args, '--check');
  const schemaOnly = flag(args, '--schema-only');
  const packDir = resolve(cwd, option(args, '--pack') ?? BASE_PACK_DIR);
  if (args.length === 0) return usage();
  let failed = false;
  for (const file of args) {
    const bp = parseBlueprint(JSON.parse(await readFile(resolve(cwd, file), 'utf8')));
    const files = await mapFiles(buildMap(bp), join(packDir, 'x.json'));
    const errors = schemaOnly ? validateSchemasOnly(files) : await validate(files, bp.id, packDir);
    if (errors.length > 0) {
      console.error(`${file}: ${errors.length} błędów\n${errors.join('\n')}`);
      failed = true;
      continue;
    }
    const before = await existing(packDir, bp.id);
    const stale = [...before.keys()].filter((p) => !files.some((f) => f.path === p));
    const changed = files.filter((f) => before.get(f.path) !== f.text);
    if (check) {
      if (changed.length > 0 || stale.length > 0) {
        console.error(
          `${bp.id}: pliki nieaktualne (${[...changed.map((f) => f.path), ...stale].join(', ')})`,
        );
        failed = true;
      } else console.log(`${bp.id}: aktualne`);
      continue;
    }
    await write(packDir, changed, stale);
    console.log(
      `${bp.id}: ${files.length} plików w ${join(packDir, 'maps', bp.id)} (zmienione: ${changed.length}, usunięte: ${stale.length})`,
    );
  }
  return failed ? 1 : 0;
}

async function validate(files: MapFile[], id: string, packDir: string): Promise<string[]> {
  const pack = await readPackDir(packDir);
  // Packs other than base are validated on top of base (by manifest id, so copies work too).
  const manifest = pack.files.find((f) => f.path === 'mod.json');
  const packId =
    manifest && 'text' in manifest ? (JSON.parse(manifest.text) as { id?: string }).id : '';
  const deps = packId === 'base' ? [] : [await readPackDir(BASE_PACK_DIR)];
  return formatErrors(validateWithPack(files, id, pack, deps));
}

async function write(packDir: string, files: MapFile[], stale: string[]): Promise<void> {
  for (const f of files) {
    const abs = join(packDir, f.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.text);
  }
  for (const p of stale) await rm(join(packDir, p));
}

async function validateCmd(args: string[]): Promise<number> {
  const dirs = args.length > 0 ? args.map((d) => resolve(cwd, d)) : [BASE_PACK_DIR];
  const r = await validatePackDirs(dirs);
  for (const e of formatErrors(r)) console.error(e);
  for (const m of r.maps) {
    const edges = m.chunks.reduce((n, c) => n + c.edges.length, 0);
    const rooms = new Set(m.chunks.flatMap((c) => Object.keys(c.rooms))).size;
    console.log(`${m.id}: ${m.chunks.length} chunków, ${edges} krawędzi, ${rooms} pomieszczeń`);
  }
  console.log(r.ok ? 'OK' : `${r.errors.length} błędów`);
  return r.ok ? 0 : 1;
}

function usage(): number {
  console.error(USAGE);
  return 2;
}

const [cmd, ...rest] = process.argv.slice(2);
const run =
  cmd === 'build' ? build(rest) : cmd === 'validate' ? validateCmd(rest) : Promise.resolve(usage());
run.then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  },
);
