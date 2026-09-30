import { REQUIRED_APPEARANCE_SLOTS, type AppearanceSlot } from '../../schemas/appearance-part.js';
import type { PaletteKind } from '../../schemas/palette.js';
import type { ContentIndex } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';
import type { SourceRef } from '../source.js';

const SLOT_PALETTE: Record<AppearanceSlot, PaletteKind> = {
  face: 'skin',
  hair: 'hair',
  beard: 'hair',
  top: 'cloth',
  bottom: 'cloth',
  shoes: 'cloth',
};

/**
 * Wygląd: kolory palety mają unikalne id, kanał części używa palety właściwego rodzaju
 * (włosy/broda → hair, ubrania → cloth, twarz → skin), każdy wymagany slot ma co najmniej 1 opcję.
 * Sprawdza sloty tylko, gdy zawartość ma jakiekolwiek części. `where` wskazuje plik ustawień świata dla błędów bez własnej definicji.
 */
export function checkAppearance(index: ContentIndex, where: SourceRef, sink: ErrorSink): void {
  const palettes = index.map('palette');
  for (const def of palettes.values()) {
    const seen = new Set<string>();
    def.data.colors.forEach((c, i) => {
      if (seen.has(c.id))
        sink.add({
          code: 'palette_duplicate_color',
          message: `paleta „${def.id}”: kolor „${c.id}” powtórzony`,
          pack: def.source.pack,
          file: def.source.file,
          path: formatJsonPath([...def.source.path, 'colors', i, 'id']),
        });
      seen.add(c.id);
    });
  }
  const slots = new Set<string>();
  for (const def of index.map('appearancePart').values()) {
    const part = def.data;
    slots.add(part.slot);
    part.tints.forEach((t, i) => {
      const kind = palettes.get(t.palette)?.data.kind;
      if (kind && kind !== SLOT_PALETTE[part.slot])
        sink.add({
          code: 'appearance_palette_kind',
          message: `„${def.id}” (${part.slot}) używa palety „${t.palette}” rodzaju ${kind}, oczekiwano ${SLOT_PALETTE[part.slot]}`,
          pack: def.source.pack,
          file: def.source.file,
          path: formatJsonPath([...def.source.path, 'tints', i, 'palette']),
        });
    });
  }
  // Paczka bez części wyglądu (np. mod bez postaci) nie musi mieć slotów.
  if (slots.size > 0)
    for (const slot of REQUIRED_APPEARANCE_SLOTS)
      if (!slots.has(slot))
        sink.add({
          code: 'appearance_slot_empty',
          message: `slot wyglądu „${slot}” nie ma żadnej części`,
          pack: where.pack,
          file: where.file,
          path: formatJsonPath([...where.path, 'characterCreation']),
        });
}
