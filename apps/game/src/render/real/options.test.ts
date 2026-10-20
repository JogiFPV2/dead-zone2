import { describe, expect, it } from 'vitest';
import { DEFAULT_RENDER, parseRenderOptions } from './options.js';

describe('parseRenderOptions', () => {
  it('default look unless ?style=real', () => {
    expect(parseRenderOptions('')).toEqual({ style: 'default', quality: 'medium' });
    expect(parseRenderOptions('?style=pixel&quality=ultra')).toEqual(DEFAULT_RENDER);
  });

  it('?style=real&quality=low|medium|high', () => {
    expect(parseRenderOptions('?style=real&quality=low')).toEqual({
      style: 'real',
      quality: 'low',
    });
    expect(parseRenderOptions('?quality=high&style=real').quality).toBe('high');
    expect(parseRenderOptions('?style=real').quality).toBe('medium');
  });

  it('the stored setting decides without ?style=; the URL overrides it', () => {
    expect(parseRenderOptions('', 'real').style).toBe('real');
    expect(parseRenderOptions('?quality=low', 'real')).toEqual({ style: 'real', quality: 'low' });
    expect(parseRenderOptions('?style=classic', 'real').style).toBe('default');
    expect(parseRenderOptions('?style=default', 'real').style).toBe('default');
    expect(parseRenderOptions('?style=real', 'default').style).toBe('real');
    // An unknown ?style= (e.g. a graphics style id) leaves the stored choice.
    expect(parseRenderOptions('?style=pixel', 'real').style).toBe('real');
  });
});
