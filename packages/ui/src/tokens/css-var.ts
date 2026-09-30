import { cssVarName } from './generate.js';
import type { TokenPath } from './tokens.generated.js';

/** Dot path → `var(--…)`: `cssVar('color.moodle.neg.3.bg')` → `var(--color-moodle-neg-3-bg)`. */
export const cssVar = (path: TokenPath): string => `var(${cssVarName(path)})`;

export { cssVarName };
