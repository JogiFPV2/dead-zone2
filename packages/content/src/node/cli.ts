import { resolve } from 'node:path';
import { formatError } from '../validate/format.js';
import { validatePackDirs } from './index.js';

/**
 * Użycie: `pnpm --filter @deadzone/content validate <katalog> [kolejne paczki…]`
 * Kolejność wczytywania wynika z manifestów (zależności, loadAfter, priority).
 */
async function main(argv: string[]): Promise<number> {
  const dirs = argv.filter((a) => !a.startsWith('-'));
  if (dirs.length === 0) {
    console.error('użycie: validate <katalog-paczki> [kolejne-paczki…]');
    return 2;
  }
  // pnpm --filter uruchamia skrypt w katalogu pakietu; INIT_CWD to katalog wywołania.
  const base = process.env['INIT_CWD'] ?? process.cwd();
  const result = await validatePackDirs(dirs.map((d) => resolve(base, d)));
  for (const e of result.errors) console.error(formatError(e));

  const counts = new Map<string, number>();
  for (const d of result.content.all()) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
  const summary = [...counts].map(([t, n]) => `${t}: ${n}`).join(', ');
  const mods = result.loadOrder.map((m) => `${m.id}@${m.version}`).join(' → ');
  const maps = result.maps.map((m) => `${m.id} (${m.chunks.length} chunków)`).join(', ');
  if (result.ok) {
    console.log(`OK — ${mods} (${summary})${maps ? `; mapy: ${maps}` : ''}`);
    return 0;
  }
  console.error(`\n${result.errors.length} błędów`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e);
    process.exit(2);
  },
);
