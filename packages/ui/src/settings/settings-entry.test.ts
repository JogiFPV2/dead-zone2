import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_DIRS = ['settings', 'hud-layout'];
const ALLOWED_PACKAGES = ['zod'];
const DOM = /\b(document|window|HTMLElement|navigator|localStorage|createElement)\b/;

/** Every file reachable from the `@deadzone/ui/settings` entry. */
function graph(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    const text = readFileSync(file, 'utf8');
    const specs = [...text.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map(
      (m) => m[1]!,
    );
    seen.set(file, specs);
    for (const s of specs) {
      if (s.startsWith('.')) visit(resolve(dirname(file), s.replace(/\.js$/, '.ts')));
    }
  };
  visit(entry);
  return seen;
}

it('@deadzone/ui/settings pulls no DOM code and only zod', () => {
  const files = graph(join(SRC, 'settings', 'index.ts'));
  expect(files.size).toBeGreaterThan(5);
  for (const [file, specs] of files) {
    const rel = relative(SRC, file);
    expect(
      ALLOWED_DIRS.some((d) => rel.startsWith(`${d}/`)),
      rel,
    ).toBe(true);
    for (const s of specs) {
      if (!s.startsWith('.')) expect(ALLOWED_PACKAGES, `${rel}: ${s}`).toContain(s);
    }
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(DOM.test(code), `${rel} uses DOM`).toBe(false);
  }
});

it('package.json exposes the ./settings subpath', () => {
  const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
    exports: Record<string, { default: string }>;
  };
  expect(pkg.exports['./settings']?.default).toBe('./dist/settings/index.js');
});
