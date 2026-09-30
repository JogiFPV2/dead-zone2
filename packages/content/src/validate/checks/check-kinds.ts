import type { ItemKind } from '../../schemas/item/item.js';
import type { ContentIndex } from '../content-index.js';
import type { ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';

/**
 * Referencje do przedmiotów muszą wskazywać właściwy rodzaj:
 * amunicja broni → `ammo`, magazynek → `magazine` z tą samą amunicją.
 */
export function checkItemKinds(index: ContentIndex, sink: ErrorSink): void {
  const items = index.map('item');
  for (const def of items.values()) {
    const at = (...p: (string | number)[]) => ({
      pack: def.source.pack,
      file: def.source.file,
      path: formatJsonPath([...def.source.path, ...p]),
    });
    const expect = (id: string, kind: ItemKind, ...p: (string | number)[]) => {
      const target = items.get(id);
      if (target && target.data.kind !== kind) {
        sink.add({
          code: 'wrong_kind',
          message: `„${id}” musi być przedmiotem rodzaju ${kind}, jest ${target.data.kind}`,
          ...at(...p),
        });
      }
    };
    const item = def.data;
    if (item.kind === 'weapon_ranged') {
      expect(item.ranged.ammo, 'ammo', 'ranged', 'ammo');
      const feed = item.ranged.feed;
      if (feed.type === 'magazine') {
        expect(feed.magazine, 'magazine', 'ranged', 'feed', 'magazine');
        const mag = items.get(feed.magazine)?.data;
        if (mag?.kind === 'magazine' && mag.magazine.ammo !== item.ranged.ammo) {
          sink.add({
            code: 'wrong_kind',
            message: `magazynek „${feed.magazine}” przyjmuje „${mag.magazine.ammo}”, a broń „${item.ranged.ammo}”`,
            ...at('ranged', 'feed', 'magazine'),
          });
        }
      }
    }
    if (item.kind === 'magazine') expect(item.magazine.ammo, 'ammo', 'magazine', 'ammo');
  }
}
