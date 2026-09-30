import { z } from 'zod';
import { ContentIdSchema, ExtSchema, I18nKeySchema } from './common/index.js';

/** Rodzaj palety: skóra, włosy (i broda), ubrania. */
export const PaletteKindSchema = z.enum(['skin', 'hair', 'cloth']);

/** Kolor palety: lokalne id (kebab) i `#rrggbb`. */
export const PaletteColorSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id koloru w kebab-case'),
  hex: z.string().regex(/^#[0-9a-f]{6}$/, 'kolor w postaci #rrggbb (małe litery)'),
});

/** Paleta kolorów do tworzenia postaci; kanały barwienia części wskazują paletę. */
export const ColorPaletteSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  kind: PaletteKindSchema,
  colors: z.array(PaletteColorSchema).min(1).max(64),
  ext: ExtSchema,
});

export type PaletteKind = z.infer<typeof PaletteKindSchema>;
export type PaletteColor = z.infer<typeof PaletteColorSchema>;
export type ColorPalette = z.infer<typeof ColorPaletteSchema>;
