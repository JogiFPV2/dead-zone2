/**
 * CSS + fonts into dist: fonts.css (@font-face), tokens.css (vars), components.css,
 * hud.css (= all three) and fonts/*.woff2 + licences.
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { COMPONENT_CSS, FONTS_CSS, TOKENS_CSS } from '../src/styles/files.js';
import { pkgDir } from './token-files.js';

const read = (rel: string): Promise<string> => readFile(`${pkgDir}src/${rel}`, 'utf8');

/** Copies packages/ui/fonts → <dir>/fonts. */
export async function copyFonts(dir: string): Promise<void> {
  await cp(`${pkgDir}fonts`, `${dir}/fonts`, { recursive: true });
}

export async function buildCss(): Promise<void> {
  const fonts = await read(FONTS_CSS);
  const tokens = await read(TOKENS_CSS);
  const components = (await Promise.all(COMPONENT_CSS.map(read))).join('\n');
  const dist = `${pkgDir}dist`;
  await mkdir(dist, { recursive: true });
  await writeFile(`${dist}/fonts.css`, fonts);
  await writeFile(`${dist}/tokens.css`, tokens);
  await writeFile(`${dist}/components.css`, components);
  await writeFile(`${dist}/hud.css`, `${fonts}\n${tokens}\n${components}`);
  await copyFonts(dist);
  console.log('dist/{fonts,tokens,components,hud}.css, dist/fonts/');
}

if (process.argv[1]?.endsWith('build-css.ts')) await buildCss();
