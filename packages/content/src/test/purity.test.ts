import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

describe('główne wejście jest wolne od API Node (dla przeglądarki i packages/sim)', () => {
  const pure = ['schemas', 'validate', 'bundle', 'places'].flatMap((d) => files(join(SRC, d)));
  it.each(pure.map((f) => [f.slice(SRC.length)]))('%s', (rel) => {
    const text = readFileSync(join(SRC, rel), 'utf8');
    expect(text).not.toMatch(/from ['"]node:/);
    expect(text).not.toMatch(/from ['"]\.\.\/node\//);
  });
});

describe('modularność: żaden plik źródłowy nie jest duży', () => {
  it.each(files(SRC).map((f) => [f.slice(SRC.length)]))('%s ≤ 120 linii', (rel) => {
    const lines = readFileSync(join(SRC, rel), 'utf8').trimEnd().split('\n').length;
    expect(lines).toBeLessThanOrEqual(120);
  });
});
