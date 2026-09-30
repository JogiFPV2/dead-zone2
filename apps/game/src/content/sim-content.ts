import type { SimContentSource } from '@deadzone/protocol';

/** Raw base pack for the sim worker (validated and compiled there, so zod stays in the worker). */
export async function loadSimContent(): Promise<SimContentSource> {
  const { BASE_PACK_DIR, baseFiles } = await import('./base-pack.js');
  return { packs: [{ dir: BASE_PACK_DIR, files: baseFiles }] };
}
