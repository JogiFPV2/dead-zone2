import {
  MapChunkSchema,
  MapManifestSchema,
  formatError,
  validatePacks,
  type PackSource,
  type ValidationResult,
} from '@deadzone/content';
import { z } from 'zod';
import type { MapFile } from './files.js';

/**
 * Full validation (schemas, cross refs to tiles/room types, rooms) of `pack` with the map files
 * replacing whatever that pack had under `maps/<id>/`. `deps` are other packs (e.g. base).
 */
export function validateWithPack(
  files: readonly MapFile[],
  mapId: string,
  pack: PackSource,
  deps: readonly PackSource[] = [],
): ValidationResult {
  const prefix = `maps/${mapId}/`;
  const merged: PackSource = {
    dir: pack.dir,
    files: [
      ...pack.files.filter((f) => !f.path.startsWith(prefix)),
      ...files.map((f) => ({ path: f.path, text: f.text })),
    ],
  };
  return validatePacks([...deps, merged]);
}

/** Schema-only validation (no pack, no refs): for maps whose content ids are not defined yet. */
export function validateSchemasOnly(files: readonly MapFile[]): string[] {
  const errors: string[] = [];
  for (const f of files) {
    const schema = f.path.endsWith('manifest.json') ? MapManifestSchema : MapChunkSchema;
    const r = schema.safeParse(JSON.parse(f.text));
    if (!r.success) errors.push(`${f.path}: ${z.prettifyError(r.error)}`);
  }
  return errors;
}

export const formatErrors = (r: ValidationResult): string[] => r.errors.map(formatError);
