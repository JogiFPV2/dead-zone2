/**
 * Generates `src/tokens/tokens.generated.{css,ts}` from `tokens/*.json`.
 *   pnpm --filter @deadzone/ui gen:tokens          write files
 *   pnpm --filter @deadzone/ui gen:tokens --check  exit 1 if the files are stale
 */
import { readFile, writeFile } from 'node:fs/promises';
import { cssOut, generateOutputs, tsOut } from './token-files.js';

const check = process.argv.includes('--check');
const { css, ts } = await generateOutputs();
const targets: [string, string][] = [
  [cssOut, css],
  [tsOut, ts],
];

let stale = 0;
for (const [file, content] of targets) {
  const current = await readFile(file, 'utf8').catch(() => '');
  if (current === content) continue;
  if (check) {
    console.error(`stale: ${file}`);
    stale++;
  } else {
    await writeFile(file, content);
    console.log(`wrote ${file}`);
  }
}
if (stale) {
  console.error('Run `pnpm --filter @deadzone/ui gen:tokens`.');
  process.exit(1);
}
