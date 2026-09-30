import { z } from 'zod';

/** Licences accepted without discussion (PLAN.md: CC0 at the start). SPDX ids. */
export const ALLOWED_LICENCES = ['CC0-1.0'] as const;

const Id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case');

/** Source pack definition (`tools/assets/packs/<id>.json`). */
export const PackSchema = z.strictObject({
  id: Id,
  name: z.string().min(1),
  version: z.string().optional(),
  author: z.string().min(1),
  /** SPDX licence id; required, checked against ALLOWED_LICENCES. */
  licence: z.string().min(1),
  licenceUrl: z.url(),
  /** Official page of the pack (where the licence was verified). */
  source: z.url(),
  /** Zip download; fetched into the cache and checked against `sha256`. */
  download: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Directory of the GLB files inside the zip. */
  root: z.string(),
  /**
   * Low-poly packs whose models all sample one colour-palette texture: the texture is stripped
   * from every GLB, written once per pack, and all models share one material at runtime.
   */
  palette: z
    .strictObject({
      /** Path relative to `root`. */
      image: z.string(),
      encoding: z.enum(['uastc', 'etc1s', 'png']).default('uastc'),
    })
    .optional(),
  /** Extra LOD levels: triangle ratios and the camera distance where each level starts. */
  lod: z
    .strictObject({
      ratios: z.array(z.number().gt(0).lt(1)).max(3),
      distances: z.array(z.number().positive()).max(3),
    })
    .refine(
      (l) => l.ratios.length === l.distances.length,
      'lod: ratios i distances różnej długości',
    )
    .optional(),
  /** Model file names (without `.glb`) to import from `root`. */
  models: z.array(Id).min(1),
});

export type Pack = z.output<typeof PackSchema>;

/** Validates a pack definition and its licence; throws a readable error (the build refuses it). */
export function parsePack(input: unknown, file = 'pack'): Pack {
  const raw = input as { licence?: unknown } | null;
  if (!raw || typeof raw !== 'object' || !raw.licence) {
    throw new Error(`${file}: brak wpisu licencji (licence) — asset odrzucony`);
  }
  const r = PackSchema.safeParse(input);
  if (!r.success) throw new Error(`${file}: ${z.prettifyError(r.error)}`);
  if (!(ALLOWED_LICENCES as readonly string[]).includes(r.data.licence)) {
    throw new Error(
      `${file}: licencja ${r.data.licence} nie jest dozwolona (${ALLOWED_LICENCES.join(', ')})`,
    );
  }
  return r.data;
}
