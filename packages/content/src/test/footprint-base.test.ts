import { describe, expect, it } from 'vitest';
import { FootprintSchema, footprintForId, footprintOf, occupiedTiles } from '../footprint/index.js';
import { baseBundle } from './base-bundle.js';

/** Mebel większy niż 1×1 (1 kafel = 1 m, wymiary modeli od Designera). Reszta = 1×1. */
const SIZES: Record<string, { w: number; h: number }> = {
  'base:bathtub': { w: 2, h: 1 },
  'base:shop-counter': { w: 2, h: 1 },
  'base:desk': { w: 2, h: 1 },
  'base:sofa': { w: 2, h: 1 },
  'base:metal-shelf': { w: 2, h: 1 },
  'base:bed': { w: 1, h: 2 },
};

describe('footprint mebli w paczce bazowej', () => {
  it('rozmiary > 1×1 dokładnie jak w tabeli', async () => {
    const b = await baseBundle();
    const ids = [...Object.keys(b.containers), ...Object.keys(b.items)];
    const big = Object.fromEntries(
      ids.map((id) => [id, footprintForId(b, id)] as const).filter(([, fp]) => fp.w * fp.h > 1),
    );
    expect(big).toEqual(SIZES);
  });

  it('wąski regał, lodówki, kuchenki, zlewy, szafka RTV i prysznic zostają 1×1', async () => {
    const b = await baseBundle();
    const one = ['bookshelf', 'fridge', 'fridge-freezer', 'oven', 'gas-stove', 'range'];
    for (const id of [...one, 'kitchen-sink', 'bathroom-sink', 'tv-stand', 'shower'])
      expect(footprintForId(b, `base:${id}`), id).toEqual({ w: 1, h: 1 });
  });

  it('każdy footprint przechodzi schemat i occupiedTiles daje w·h kafli przy każdym obrocie', async () => {
    const b = await baseBundle();
    for (const def of [...Object.values(b.containers), ...Object.values(b.items)]) {
      const fp = footprintOf(def);
      expect(FootprintSchema.safeParse(fp).success, def.id).toBe(true);
      for (const rot of [0, 1, 2, 3])
        expect(occupiedTiles(0, 0, rot, fp), `${def.id} rot ${rot}`).toHaveLength(fp.w * fp.h);
    }
  });

  it('schowek i przedmiot o tym samym id mają ten sam footprint', async () => {
    const b = await baseBundle();
    for (const id of Object.keys(b.containers)) {
      const item = b.items[id];
      if (item) expect(footprintOf(item), id).toEqual(footprintOf(b.containers[id]));
    }
  });
});
