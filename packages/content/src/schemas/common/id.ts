import { z } from 'zod';

/** Namespace moda w kebab-case, np. `base`, `my-mod`. */
export const NAMESPACE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/**
 * Id definicji: `<namespace>:<kebab-name>`, np. `base:canned-beans`.
 * Typ wynika z mapy/pola, więc id nie ma prefiksu typu (kontrakt z Symulacją).
 */
export const CONTENT_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/;

export const NamespaceSchema = z
  .string()
  .regex(NAMESPACE_PATTERN, 'namespace w kebab-case, np. `base`, `my-mod`');

export const ContentIdSchema = z
  .string()
  .regex(CONTENT_ID_PATTERN, 'id musi mieć postać `namespace:kebab-name`, np. `base:canned-beans`');

export type Namespace = z.infer<typeof NamespaceSchema>;
export type ContentId = z.infer<typeof ContentIdSchema>;

/** Zwraca namespace z id (`base:knife` → `base`). */
export function namespaceOf(id: string): string {
  const i = id.indexOf(':');
  return i === -1 ? '' : id.slice(0, i);
}
