import { z } from 'zod';
import { PbrMapsSchema, MATERIAL_KINDS, materialProblem, type MaterialFields } from './material.js';

/** Licences accepted without discussion (PLAN.md: CC0 at the start). SPDX ids. */
export const ALLOWED_LICENCES = ['CC0-1.0'] as const;

const Id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case');

/** Source pack definition (`tools/assets/packs/<id>.json`). */
export const PackSchema = z
  .strictObject({
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
    download: z.url().optional(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    /**
     * Instead of a zip: single files, each checked against its sha256. Either downloaded (`url`,
     * e.g. Poly Pizza GLBs) or committed in the repo (`path`, relative to `tools/assets`: sources
     * converted offline from FBX, see `src/animal-sources.ts`).
     */
    files: z
      .array(
        z
          .strictObject({
            url: z.url().optional(),
            path: z
              .string()
              .regex(/^[A-Za-z0-9._/-]+$/)
              .refine((p) => !p.includes('..'), 'path bez ..')
              .optional(),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            /** File name inside `root`. */
            name: z.string().regex(/^[A-Za-z0-9._-]+$/),
          })
          .refine((f) => !!f.url !== !!f.path, 'podaj url albo path'),
      )
      .min(1)
      .optional(),
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
    /**
     * Models to import from `root`: file name (without `.glb`) = id, or `{ id, file?, material?,
     * pbr? }` (`file` defaults to `id`; `material` see `material.ts`, default `vc`).
     */
    models: z
      .array(
        z.union([
          Id,
          z
            .strictObject({
              id: Id,
              file: z.string().min(1).optional(),
              material: z.enum(MATERIAL_KINDS).optional(),
              pbr: PbrMapsSchema.optional(),
            })
            .superRefine((m, ctx) => {
              const problem = materialProblem(m);
              if (problem) ctx.addIssue({ code: 'custom', message: `${m.id}: ${problem}` });
            }),
        ]),
      )
      .min(1),
    /** Keep skins and animations (characters): no LOD, no palette. */
    animated: z.boolean().optional(),
    /**
     * Animated packs: clips to keep (name or `Armature|name`; the first clip of each name wins,
     * duplicates and every other clip are dropped to save bytes).
     */
    keepAnimations: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine(
    (p) => (p.files ? !p.download && !p.sha256 : !!p.download && !!p.sha256),
    'podaj download + sha256 albo files',
  );

/** `{ id, file }` of a `models` entry. */
export const modelRef = (
  m: Pack['models'][number],
): { id: string; file: string } & MaterialFields =>
  typeof m === 'string' ? { id: m, file: m } : { ...m, file: m.file ?? m.id };

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
