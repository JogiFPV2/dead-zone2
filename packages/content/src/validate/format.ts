import type { ContentError } from './errors.js';

/** Jedna linia na błąd: `data/base/items/weapons.json $[0].melee.skill [missing_ref] …`. */
export function formatError(e: ContentError): string {
  const file = e.pack.endsWith('/') ? `${e.pack}${e.file}` : `${e.pack}/${e.file}`;
  return `${file} ${e.path} [${e.code}] ${e.message}`;
}
