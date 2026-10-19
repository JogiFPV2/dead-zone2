import { describe, expect, it } from 'vitest';
import { itemViewName } from '../crafting-labels.js';
import { moodleVMs } from '../hud-model.js';
import { EMPTY_HUD_CONTENT } from '../content-index.js';

describe('dirty moodle and burnt food (protocols 31, 34)', () => {
  it('shows base:dirty as a negative „Brud” moodle even without its content definition', () => {
    const [m] = moodleVMs({ 'base:dirty': 3 }, EMPTY_HUD_CONTENT, new Map(), 0);
    expect(m).toMatchObject({ id: 'base:dirty', label: 'Brud', polarity: 'neg', level: 3 });
  });

  it('marks burnt food in its name', () => {
    expect(itemViewName({ def: 'base:apple', burnt: true })).toMatch(/\(przypalone\)$/);
    expect(itemViewName({ def: 'base:apple' })).not.toMatch(/przypalone/);
  });
});
