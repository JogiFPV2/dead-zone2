import { buildContentBundle } from '@deadzone/content';
import { compileContent, type ContentIndex } from '@deadzone/sim';

/** Base pack validated and compiled on the main thread (creator only; lazy chunk with zod). */
export async function loadCreatorContent(): Promise<ContentIndex> {
  const { BASE_PACK_DIR, baseFiles } = await import('../content/base-pack.js');
  return compileContent(buildContentBundle([{ dir: BASE_PACK_DIR, files: [...baseFiles] }]));
}
