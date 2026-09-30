/**
 * Order of the CSS files concatenated into `dist/components.css` / `dist/hud.css`
 * (paths relative to `src/`). Used by `scripts/build-css.ts`, the preview and tests.
 */
export const TOKENS_CSS = 'tokens/tokens.generated.css';

/** @font-face for the self-hosted fonts; URLs are relative to dist/ (fonts in dist/fonts/). */
export const FONTS_CSS = 'styles/fonts.css';

export const COMPONENT_CSS = [
  'styles/base.css',
  'mood/mood.css',
  'components/key-badge/key-badge.css',
  'components/moodle/moodle.css',
  'components/stat-bar/stat-bar.css',
  'components/inventory-slot/inventory-slot.css',
  'components/action-button/action-button.css',
  'components/minimap/minimap.css',
  'components/threat-banner/threat-banner.css',
  'components/clock/clock.css',
  'components/toast/toast.css',
  'components/key-hints/key-hints.css',
  'components/objective-card/objective-card.css',
  // Last: overrides the effects above.
  'styles/reduced-motion.css',
] as const;
