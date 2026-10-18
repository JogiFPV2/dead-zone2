import { z } from 'zod';

/**
 * How a model is shaded (realistic style pilot, `render.style = 'real'` in the client):
 * - `vc` (default): vertex colours / the pack palette, today's look;
 * - `pbr`: the shared layered PBR textures (`pbr.albedo`, `normal`, `orm` texture arrays plus
 *   `layers` describing each layer). The layer of a vertex lives in the GLB (`TEXCOORD_1`),
 *   not in the data.
 * Old data without the field stays `vc`, unchanged.
 */
export const MATERIAL_KINDS = ['vc', 'pbr'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** Path relative to `apps/game/public` with one of the given extensions. */
function publicPath(exts: readonly string[], what: string) {
  const re = new RegExp(`\\.(${exts.join('|')})$`, 'i');
  return z
    .string()
    .min(1)
    .refine((p) => !p.startsWith('/') && !/^[a-z]+:/i.test(p), 'ścieżka względna do public')
    .refine((p) => !p.split('/').includes('..') && !p.includes('\\'), 'ścieżka bez .. i \\')
    .refine((p) => re.test(p), what);
}

/** Texture path relative to `apps/game/public` (e.g. `textures/pbr/deadzone-pbr-albedo-1024.ktx2`). */
export const PublicTexturePath = publicPath(
  ['ktx2', 'png', 'webp'],
  'tekstura .ktx2, .png albo .webp',
);
/** `layers.json` path relative to `apps/game/public`. */
export const PublicJsonPath = publicPath(['json'], 'plik .json');

/** One resolution of the PBR textures: albedo, normal and ORM (occlusion, roughness, metalness). */
export const PbrTexturesSchema = z.strictObject({
  albedo: PublicTexturePath,
  normal: PublicTexturePath,
  orm: PublicTexturePath,
});
export type PbrTextures = z.output<typeof PbrTexturesSchema>;

/** PBR maps of a model: full-res textures, the layer description and optional low-res textures. */
export const PbrMapsSchema = z.strictObject({
  albedo: PublicTexturePath,
  normal: PublicTexturePath,
  orm: PublicTexturePath,
  layers: PublicJsonPath,
  lowRes: PbrTexturesSchema.optional(),
});
export type PbrMaps = z.output<typeof PbrMapsSchema>;

/** Every texture / JSON file a `pbr` entry points at (for `assets check`). */
export function pbrFiles(p: PbrMaps): string[] {
  const low = p.lowRes ? [p.lowRes.albedo, p.lowRes.normal, p.lowRes.orm] : [];
  return [p.albedo, p.normal, p.orm, p.layers, ...low];
}

/**
 * `layers.json` (Designer's `assets-src/pbr/layers.json`): the layers of the texture arrays,
 * `layers[i].index === i`. Extra per-layer fields are allowed.
 */
export const PbrLayerSchema = z.looseObject({
  index: z.number().int().min(0),
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  url: z.url().nullable(),
  tileMeters: z.number().positive(),
  tint: z.enum(['natural', 'tint']),
  meanLinear: z.tuple([z.number(), z.number(), z.number()]),
  meanRoughness: z.number().min(0).max(1),
});
export const PbrLayersFileSchema = z
  .looseObject({
    version: z.literal(1),
    material: z.string().min(1),
    layers: z.array(PbrLayerSchema).min(1),
  })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    f.layers.forEach((l, i) => {
      if (l.index !== i)
        ctx.addIssue({
          code: 'custom',
          path: ['layers', i, 'index'],
          message: `index ${l.index} ≠ ${i}`,
        });
      if (ids.has(l.id))
        ctx.addIssue({
          code: 'custom',
          path: ['layers', i, 'id'],
          message: `powtórzone id ${l.id}`,
        });
      ids.add(l.id);
    });
  });
export type PbrLayersFile = z.output<typeof PbrLayersFileSchema>;

/** `material` / `pbr` as parsed (optional fields may be explicitly undefined). */
export interface MaterialFields {
  material?: MaterialKind | undefined;
  pbr?: PbrMaps | undefined;
}

/** Checks the pairing (used as a refine by the entry schemas). */
export function materialProblem(f: MaterialFields): string | undefined {
  if (f.material === 'pbr' && !f.pbr)
    return 'material: pbr wymaga pola pbr { albedo, normal, orm, layers }';
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
