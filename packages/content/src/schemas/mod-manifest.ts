import { z } from 'zod';
import { I18nKeySchema, NamespaceSchema } from './common/index.js';

/** Wersja semver (bez zakresów). */
export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'wersja semver, np. 1.0.0');

/** Zakres wersji: `*`, `1.2.3`, `^1.2.0`, `~1.2.0`, `>=1.0.0`. */
export const VersionRangeSchema = z
  .string()
  .regex(
    /^(\*|(\^|~|>=|<=|>|<|=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/,
    'zakres wersji, np. ^1.0.0',
  );

export const ModDependencySchema = z.strictObject({
  id: NamespaceSchema,
  version: VersionRangeSchema.default('*'),
  optional: z.boolean().default(false),
});

/**
 * Plik `mod.json` w korzeniu paczki. `id` moda = namespace wszystkich jego definicji.
 * Kolejność: najpierw zależności, potem `loadAfter`, remisy rozstrzyga `priority` (mniejszy wcześniej).
 */
export const ModManifestSchema = z.strictObject({
  id: NamespaceSchema,
  name: z.string().min(1),
  version: SemverSchema,
  description: z.string().optional(),
  authors: z.array(z.string()).default([]),
  /** Zakres wersji gry, z którą mod działa. */
  gameVersion: VersionRangeSchema.default('*'),
  dependencies: z.array(ModDependencySchema).default([]),
  loadAfter: z.array(NamespaceSchema).default([]),
  loadBefore: z.array(NamespaceSchema).default([]),
  priority: z.number().int().default(0),
  /** Katalog z tłumaczeniami względem korzenia paczki. */
  i18n: z.string().default('i18n'),
  nameKey: I18nKeySchema.optional(),
});

export type ModDependency = z.infer<typeof ModDependencySchema>;
export type ModManifest = z.infer<typeof ModManifestSchema>;
