import { tokens } from './tokens.generated.js';

/**
 * @deprecated Placeholder palette from before HUD A (still used by apps/web). Mapped onto the
 * HUD A tokens; use `tokens` / `cssVar` in new code.
 */
export const colors = {
  background: tokens.color.neutral['950'],
  surface: tokens.color.neutral['800'],
  text: tokens.color.text.primary,
  accent: tokens.color.accent.base,
  danger: tokens.color.danger.base,
} as const;

/** @deprecated See `colors`. */
export type ColorToken = keyof typeof colors;
