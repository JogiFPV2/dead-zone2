// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HudLayout, HudLayoutSlot } from '@deadzone/ui/settings';
import type { LayoutApplier } from './apply-layout.js';
import type { Rect } from './hud-layout-model.js';
import { createHudEditor } from './hud-editor.js';

const key = (code: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init });

const RECTS: Partial<Record<HudLayoutSlot, Rect>> = {
  minimap: { left: 1078, top: 18, width: 184, height: 184 },
  hotbar: { left: 452, top: 640, width: 376, height: 62 },
  status: { left: 18, top: 48, width: 240, height: 120 },
};
const EMPTY: HudLayout = { version: 1, elements: {} };

function setup(layout: HudLayout = EMPTY) {
  const root = document.createElement('div');
  Object.defineProperty(root, 'clientWidth', { value: 1280 });
  Object.defineProperty(root, 'clientHeight', { value: 720 });
  root.getBoundingClientRect = () => new DOMRect(0, 0, 1280, 720);
  document.body.appendChild(root);
  let applied = layout;
  const applier: LayoutApplier = {
    apply: vi.fn((l: HudLayout) => {
      applied = l;
    }),
    reclamp: vi.fn(),
    rectOf: (s) => RECTS[s],
    get layout() {
      return applied;
    },
  };
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const setPreview = vi.fn();
  const ed = createHudEditor({ root, layout, applier, uiScale: 1, setPreview, onSave, onCancel });
  return { root, ed, applier, onSave, onCancel, setPreview };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('HUD editor', () => {
  it('shows a frame per element, the toolbar and the panel; sample content on', () => {
    const { root, setPreview } = setup();
    expect(root.querySelector('.dz-hed__frame[data-slot="minimap"]')).not.toBeNull();
    expect(root.querySelector('.dz-hed__frame[data-slot="hotbar"][data-sel]')).not.toBeNull();
    expect(root.querySelector('.dz-hed__bar')?.textContent).toContain('EDYCJA HUD');
    expect(root.querySelector('.dz-hed__panel')?.textContent).toContain('Resetuj element');
    expect(setPreview).toHaveBeenCalledWith(true);
  });

  it('arrows move the selected element (hotbar), Enter saves the draft', () => {
    const { ed, onSave, setPreview, root } = setup();
    ed.onKey(key('ArrowUp', { shiftKey: true }));
    const hot = ed.layout.elements.hotbar;
    expect(hot).toBeDefined();
    expect(hot!.anchor).toBe('bc');
    ed.onKey(key('Enter'));
    expect(onSave).toHaveBeenCalledOnce();
    expect((onSave.mock.calls[0]![0] as HudLayout).elements.hotbar).toEqual(hot);
    expect(setPreview).toHaveBeenLastCalledWith(false);
    expect(root.querySelector('.dz-hed')).toBeNull();
  });

  it('+/− scale in 5 % steps within 50–150 %, R resets the element, Ctrl+Z undoes', () => {
    const { ed } = setup();
    for (let i = 0; i < 30; i++) ed.onKey(key('Equal'));
    expect(ed.layout.elements.hotbar!.scale).toBe(1.5);
    ed.onKey(key('KeyR'));
    expect(ed.layout.elements.hotbar).toBeUndefined();
    ed.onKey(key('KeyZ', { ctrlKey: true }));
    expect(ed.layout.elements.hotbar!.scale).toBe(1.5);
  });

  it('Esc with changes asks first; Anuluj restores the start layout', () => {
    const start: HudLayout = {
      version: 1,
      elements: { minimap: { anchor: 'tr', x: 0, y: 0, scale: 0.7, opacity: 0.55, visible: true } },
    };
    const { ed, applier, onCancel, root } = setup(start);
    ed.onKey(key('ArrowLeft'));
    ed.onKey(key('Escape'));
    expect(root.querySelector('.dz-hed__confirm')).not.toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    ed.onKey(key('Enter'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(applier.layout).toEqual(start);
  });

  it('Tab cycles the selection; Del hides the element (kept faint while editing)', () => {
    const { ed } = setup();
    ed.onKey(key('Tab'));
    ed.onKey(key('Delete'));
    const hidden = Object.values(ed.layout.elements).filter((e) => e && !e.visible);
    expect(hidden.length).toBe(1);
  });
});
