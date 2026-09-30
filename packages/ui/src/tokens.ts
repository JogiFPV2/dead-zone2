/** Design tokens placeholder. The real palette comes from the Designer's style guide. */
export const colors = {
  background: '#101214',
  surface: '#1c1f22',
  text: '#e6e6e6',
  accent: '#c8a34a',
  danger: '#b33a3a',
} as const;

export type ColorToken = keyof typeof colors;
