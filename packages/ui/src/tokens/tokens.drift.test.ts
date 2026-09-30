import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { cssOut, generateOutputs, tsOut } from '../../scripts/token-files.js';

// Fails when tokens/*.json changed without `pnpm --filter @deadzone/ui gen:tokens`
// (or when someone edited the generated files by hand).
it('generated tokens are in sync with tokens/*.json', async () => {
  const { css, ts } = await generateOutputs();
  expect(readFileSync(cssOut, 'utf8'), 'src/tokens/tokens.generated.css is stale').toBe(css);
  expect(readFileSync(tsOut, 'utf8'), 'src/tokens/tokens.generated.ts is stale').toBe(ts);
});
