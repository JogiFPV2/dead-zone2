import { z } from 'zod';

/**
 * How a model is shaded (realistic style pilot, `render.style = 'real'` in the client):
 * - `vc` (default): vertex colours / the pack palette, today's look;
 * - `pbr`: textures from a PBR atlas (`pbr.atlas`, optional `normal` and `roughness` maps).
 * Old data without the field stays `vc`, unchanged.
 */
export const MATERIAL_KINDS = ['vc', 'pbr'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** Texture path relative to `apps/game/public` (e.g. `textures/blok-p4/atlas.ktx2`). */
export const PublicTexturePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !/^[a-z]+:/i.test(p), 'ścieżka względna do public')
  .refine((p) => !p.split('/').includes('..') && !p.includes('\\'), 'ścieżka bez .. i \\')
  .refine((p) => /\.(ktx2|png|webp|jpe?g)$/i.test(p), 'tekstura .ktx2, .png, .webp albo .jpg');

/** PBR atlas of a model: base colour atlas, optional normal and roughness maps. */
export const PbrMapsSchema = z.strictObject({
  atlas: PublicTexturePath,
  normal: PublicTexturePath.optional(),
  roughness: PublicTexturePath.optional(),
});
export type PbrMaps = z.output<typeof PbrMapsSchema>;

/** `material` / `pbr` as parsed (optional fields may be explicitly undefined). */
export interface MaterialFields {
  material?: MaterialKind | undefined;
  pbr?: PbrMaps | undefined;
}

/** Checks the pairing (used as a refine by the entry schemas). */
export function materialProblem(f: MaterialFields): string | undefined {
  if (f.material === 'pbr' && !f.pbr) return 'material: pbr wymaga pola pbr { atlas, … }';
  if ((f.material ?? 'vc') === 'vc' && f.pbr) return 'pole pbr tylko przy material: pbr';
  return undefined;
}

/** Resolved material of an entry: `vc` without maps, or `pbr` with them. */
export type ResolvedMaterial = { material: 'vc' } | { material: 'pbr'; pbr: PbrMaps };

export function materialOf(f: MaterialFields): ResolvedMaterial {
  return f.material === 'pbr' && f.pbr ? { material: 'pbr', pbr: f.pbr } : { material: 'vc' };
}

/**
 * `material` + `pbr` fields on their own (other entry schemas, e.g. the town kit): `pbr` is
 * required with `material: 'pbr'` and refused with `vc`.
 */
export const MaterialFieldsSchema = z
  .strictObject({
    material: z.enum(MATERIAL_KINDS).optional(),
    pbr: PbrMapsSchema.optional(),
  })
  .superRefine((f, ctx) => {
    const problem = materialProblem(f);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });
