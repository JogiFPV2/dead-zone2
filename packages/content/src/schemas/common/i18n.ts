import { z } from 'zod';

/** Klucz tłumaczenia, np. `item.base.kitchen-knife.name`. Teksty żyją w plikach językowych. */
export const I18nKeySchema = z
  .string()
  .regex(
    /^[a-z0-9-]+(\.[a-z0-9-]+)+$/,
    'klucz i18n: segmenty rozdzielone kropką, np. `item.base.kitchen-knife.name`',
  );

export type I18nKey = z.infer<typeof I18nKeySchema>;
