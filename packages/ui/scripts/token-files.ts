import { readdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { mergeGroups, toCss, toTs } from '../src/tokens/generate.js';

export const pkgDir = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
export const tokensDir = `${pkgDir}tokens`;
export const cssOut = `${pkgDir}src/tokens/tokens.generated.css`;
export const tsOut = `${pkgDir}src/tokens/tokens.generated.ts`;

export async function readTokenSources(): Promise<Record<string, unknown>> {
  const files: Record<string, unknown> = {};
  for (const name of (await readdir(tokensDir)).sort()) {
    if (!name.endsWith('.json')) continue;
    files[name.slice(0, -'.json'.length)] = JSON.parse(
      await readFile(`${tokensDir}/${name}`, 'utf8'),
    ) as unknown;
  }
  return files;
}

async function format(code: string, filepath: string): Promise<string> {
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(code, { ...config, filepath });
}

/** Expected contents of the generated files, formatted like the rest of the repo. */
export async function generateOutputs(): Promise<{ css: string; ts: string }> {
  const tree = mergeGroups(await readTokenSources());
  return {
    css: await format(toCss(tree), cssOut),
    ts: await format(toTs(tree), tsOut),
  };
}
