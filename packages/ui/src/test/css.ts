/** Test helpers: read package CSS and look up declarations by exact selector. */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_CSS, TOKENS_CSS } from '../styles/files.js';
import { cssVarName } from '../tokens/generate.js';
import type { TokenPath } from '../tokens/tokens.generated.js';

// String form: under happy-dom the global URL is not Node's.
const srcDir = `${dirname(dirname(fileURLToPath(import.meta.url)))}/`;
export const readCss = (rel: string): string => readFileSync(`${srcDir}${rel}`, 'utf8');
export const tokensCss = (): string => readCss(TOKENS_CSS);
export const componentCss = (): string => COMPONENT_CSS.map(readCss).join('\n');

export interface Rule {
  selectors: string[];
  decls: Record<string, string>;
}

/** Flat rules (comments and @keyframes stripped). Good enough for our hand-written CSS. */
export function parseRules(css: string): Rule[] {
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const out: Rule[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = splitTopLevel(m[1] ?? '')
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    const decls: Record<string, string> = {};
    for (const d of (m[2] ?? '').split(';')) {
      const i = d.indexOf(':');
      if (i > 0)
        decls[d.slice(0, i).trim()] = d
          .slice(i + 1)
          .trim()
          .replace(/\s+/g, ' ');
    }
    out.push({ selectors, decls });
  }
  return out;
}

/** Merged declarations of every rule that lists exactly `selector`. */
export function declsFor(css: string, selector: string): Record<string, string> {
  return Object.assign(
    {},
    ...parseRules(css)
      .filter((r) => r.selectors.includes(selector))
      .map((r) => r.decls),
  ) as Record<string, string>;
}

export const v = (path: TokenPath): string => `var(${cssVarName(path)})`;

/** `@keyframes` names defined in the CSS. */
export const keyframes = (css: string): string[] =>
  [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1] ?? '');

/** Splits a selector list on commas outside parentheses (`:is(a, b)` stays whole). */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
