import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { readCss } from '../test/css.js';
import { tokens } from '../tokens/tokens.generated.js';

const pkg = `${dirname(dirname(dirname(fileURLToPath(import.meta.url))))}/`;
const fonts = readCss('styles/fonts.css');

it('self-hosts Inter and JetBrains Mono (latin + latin-ext) with their OFL licences', () => {
  const urls = [...fonts.matchAll(/url\('\.\/fonts\/([^']+)'\)/g)].map((m) => m[1] ?? '');
  expect(urls.sort()).toEqual([
    'inter-latin-ext-wght-normal.woff2',
    'inter-latin-wght-normal.woff2',
    'jetbrains-mono-latin-ext-wght-normal.woff2',
    'jetbrains-mono-latin-wght-normal.woff2',
  ]);
  for (const file of urls) {
    const bytes = readFileSync(`${pkg}fonts/${file}`);
    expect(bytes.subarray(0, 4).toString('latin1'), file).toBe('wOF2');
  }
  for (const licence of ['OFL-Inter.txt', 'OFL-JetBrainsMono.txt']) {
    expect(readFileSync(`${pkg}fonts/${licence}`, 'utf8')).toContain(
      'SIL Open Font License, Version 1.1',
    );
  }
  // Family names match the font tokens.
  expect(tokens.font.family.sans.startsWith("'Inter'")).toBe(true);
  expect(tokens.font.family.mono.startsWith("'JetBrains Mono'")).toBe(true);
  expect(fonts).toContain("font-family: 'Inter';");
  expect(fonts).toContain("font-family: 'JetBrains Mono';");
});

it('has no Google Fonts dependency left in the package', () => {
  const files = ['README.md', 'scripts/preview.ts', 'preview/preview.css'];
  const walk = (dir: string): string[] =>
    readdirSync(`${pkg}${dir}`, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
  for (const file of [...files, ...walk('src')].filter((f) => existsSync(`${pkg}${f}`))) {
    if (file.endsWith('fonts.test.ts')) continue;
    expect(readFileSync(`${pkg}${file}`, 'utf8'), file).not.toMatch(
      /fonts\.(googleapis|gstatic)\.com/,
    );
  }
});
