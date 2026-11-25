import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ZOOM_LIMITS } from '../../camera/zoom.js';
import { TOUCH_ZOOM_LIMITS, clampTouchZoom, createMobileViewStore } from './mobile-view-store.js';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const old = { cameraZoom: 1.3, minimapZoom: 0.227, bigMapZoom: 0.5 };

describe('mobile view store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('migrates saved values into dz.mobile.* keys', () => {
    const s = mem();
    const st = createMobileViewStore(s, old);
    expect(st.get('cameraZoom')).toBe(1.3);
    expect(s.m.get('dz.mobile.cameraZoom')).toBe('1.3');
    expect(s.m.get('dz.mobile.minimapZoom')).toBe('0.227');
    expect(s.m.get('dz.mobile.bigmapZoom')).toBe('0.5');
  });
  it('stored keys win over migration values', () => {
    const st = createMobileViewStore(mem({ 'dz.mobile.cameraZoom': '1.9' }), old);
    expect(st.get('cameraZoom')).toBe(1.9);
  });
  it('writes debounced 300 ms', () => {
    const s = mem();
    const st = createMobileViewStore(s, old);
    st.set('cameraZoom', 1.5);
    st.set('cameraZoom', 1.8);
    vi.advanceTimersByTime(299);
    expect(s.m.get('dz.mobile.cameraZoom')).toBe('1.3');
    vi.advanceTimersByTime(1);
    expect(s.m.get('dz.mobile.cameraZoom')).toBe('1.8');
  });
  it('survives a throwing storage', () => {
    const bad = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(createMobileViewStore(bad, old).get('bigMapZoom')).toBe(0.5);
  });
  it('touch zoom range 0.6–6, same as desktop (close-up ~4 m, Paweł 25.11)', () => {
    expect([TOUCH_ZOOM_LIMITS.min, TOUCH_ZOOM_LIMITS.max]).toEqual([0.6, 6]);
    expect([DEFAULT_ZOOM_LIMITS.min, DEFAULT_ZOOM_LIMITS.max]).toEqual([0.6, 6]);
    expect(clampTouchZoom(8)).toBe(6);
  });
});
