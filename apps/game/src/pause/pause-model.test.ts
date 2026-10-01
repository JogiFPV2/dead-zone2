import { describe, expect, it, vi } from 'vitest';
import {
  PAUSE_ITEMS,
  escapeAction,
  handleEscape,
  lastSaveLine,
  pauseKey,
  pauseSubtitle,
  stepPauseFocus,
} from './pause-model.js';

const win = (open: boolean) => ({ open, close: vi.fn() });

describe('pause model', () => {
  it('has Wróć, Ustawienia, Zapisz i wyjdź — and no separate save', () => {
    expect(PAUSE_ITEMS.map((i) => i.id)).toEqual(['resume', 'settings', 'saveExit']);
  });

  it('Escape closes an open window first, else opens the pause menu (not when dead)', () => {
    const inv = win(true);
    const craft = win(false);
    const open = vi.fn();
    expect(handleEscape([inv, craft], false, open)).toBe('closeWindow');
    expect(inv.close).toHaveBeenCalled();
    expect(craft.close).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(handleEscape([win(false), win(false)], false, open)).toBe('openPause');
    expect(open).toHaveBeenCalledTimes(1);
    expect(escapeAction([win(false)], true)).toBe('none');
  });

  it('keys: arrows/WS/Tab move, Enter/Space activate, Esc resumes', () => {
    expect(pauseKey('ArrowDown', false)).toEqual({ type: 'move', delta: 1 });
    expect(pauseKey('KeyW', false)).toEqual({ type: 'move', delta: -1 });
    expect(pauseKey('Tab', true)).toEqual({ type: 'move', delta: -1 });
    expect(pauseKey('Space', false)).toEqual({ type: 'activate' });
    expect(pauseKey('Escape', false)).toEqual({ type: 'resume' });
    expect(pauseKey('KeyI', false)).toBeUndefined();
    expect(stepPauseFocus(0, -1)).toBe(2);
    expect(stepPauseFocus(2, 1)).toBe(0);
  });

  it('formats the subtitle and the last save line', () => {
    expect(pauseSubtitle({ day: 12, minuteOfDay: 19 * 60 + 52, location: 'Riverside' })).toBe(
      'Dzień 12 · 19:52 · Riverside',
    );
    expect(pauseSubtitle({ location: 'test-town' })).toBe('test-town');
    expect(lastSaveLine({ day: 12, minuteOfDay: 19 * 60 + 51, savedAt: 0 })).toBe(
      'Ostatni zapis: Dzień 12 · 19:51 · zapis świata',
    );
    expect(lastSaveLine(undefined)).toBe('Brak zapisu świata');
  });
});
