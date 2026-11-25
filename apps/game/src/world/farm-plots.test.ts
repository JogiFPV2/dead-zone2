import { describe, expect, it } from 'vitest';
import type { FarmPlotView } from '@deadzone/protocol';
import { FarmPlots, plotModel } from './farm-plots.js';

const plot = (p: Partial<FarmPlotView>): FarmPlotView => ({
  x: 3,
  y: 4,
  z: 0,
  stage: 0,
  growth: 0,
  water: 'wet',
  ...p,
});

describe('farm plots (farming)', () => {
  it('bare soil is one bed; a plant adds one baked mesh (2 draw calls per plot)', () => {
    expect(plotModel(plot({})).children).toHaveLength(1);
    for (const crop of [
      'potato',
      'carrot',
      'cabbage',
      'onion',
      'tomato',
      'cucumber',
      'beans',
      'strawberry',
    ])
      for (const stage of [1, 2, 3, 4] as const)
        expect(plotModel(plot({ crop, stage })).children, `${crop} ${stage}`).toHaveLength(2);
  });

  it('rebuilds a plot only when crop / stage / water change, drops plots that are gone', () => {
    const f = new FarmPlots();
    f.update([plot({ crop: 'carrot', stage: 2 })]);
    const a = f.modelOf('3,4,0');
    f.update([plot({ crop: 'carrot', stage: 2, growth: 0.3 })]);
    expect(f.modelOf('3,4,0')).toBe(a);
    f.update([plot({ crop: 'carrot', stage: 3 })]);
    expect(f.modelOf('3,4,0')).not.toBe(a);
    expect(f.modelOf('3,4,0')!.position.x).toBe(3.5);
    f.update([]);
    expect(f.modelOf('3,4,0')).toBeUndefined();
    expect(f.root.children).toHaveLength(0);
  });
});
