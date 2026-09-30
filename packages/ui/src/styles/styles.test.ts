import { expect, it } from 'vitest';
import { cssVarName } from '../tokens/generate.js';
import { tokenPaths } from '../tokens/tokens.generated.js';
import { componentCss } from '../test/css.js';

const known = new Set(tokenPaths.map(cssVarName));
/** Component-local custom properties: `--_*` (private) and the HUD-level ones. */
const local = (name: string): boolean =>
  name.startsWith('--_') || ['--ui-scale', '--hud-vignette'].includes(name);

it('component CSS only references existing tokens', () => {
  const used = [...componentCss().matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '');
  const unknown = [...new Set(used)].filter((n) => !known.has(n) && !local(n));
  expect(unknown).toEqual([]);
});

it('component CSS has no raw colours (everything goes through tokens)', () => {
  const css = componentCss().replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([]);
});
