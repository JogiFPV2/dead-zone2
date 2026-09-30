import { describe, expect, it } from 'vitest';
import { parseRules, readCss } from '../test/css.js';

const css = readCss('styles/reduced-motion.css');
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
const mediaStart = clean.indexOf('@media (prefers-reduced-motion: reduce)');
const classPart = clean.slice(0, mediaStart);
const mediaPart = clean.slice(mediaStart, clean.indexOf('@keyframes'));

/** selector (normalised to the class form) → declarations */
const byTarget = (part: string, normalise: (s: string) => string) => {
  const out: Record<string, Record<string, string>> = {};
  for (const r of parseRules(part)) {
    for (const s of r.selectors) out[normalise(s)] = { ...out[normalise(s)], ...r.decls };
  }
  return out;
};
const classRules = byTarget(classPart, (s) => s.replace('.dz-reduced-motion ', ''));
const mediaRules = byTarget(mediaPart, (s) =>
  s.replace(/:not\(\.dz-full-motion \*\)/g, '').replace(/^@media[^{]*/, ''),
);

describe('reduced motion (Designer, answer 9)', () => {
  it('the class override and the media query apply the same reductions', () => {
    expect(mediaRules).toEqual(classRules);
    expect(mediaPart).toContain(':not(.dz-full-motion *)');
  });

  it('stops every pulse', () => {
    expect(classRules['.dz-moodle::before']?.animation).toBe('none !important');
    expect(classRules['.dz-statbar__fill']?.animation).toBe('none !important');
    expect(classRules['.dz-threat::before']?.animation).toBe('none !important');
    expect(classRules[".dz-threat[data-level='critical'] .dz-threat__alert"]?.display).toBe(
      'inline-flex !important',
    );
  });

  it('makes drain instant: no ghost, no fill transition', () => {
    expect(classRules['.dz-statbar[data-drain] .dz-statbar__ghost']?.display).toBe(
      'none !important',
    );
    expect(classRules['.dz-statbar__fill']?.transition).toBe('none !important');
  });

  it('replaces the scale-in with a fade over motion.reduced.fade', () => {
    expect(classRules['.dz-moodle[data-enter]']?.animation).toBe(
      'dz-fade-in var(--motion-reduced-fade) linear both !important',
    );
    expect(classRules['.dz-moodle[data-flash]']?.animation).toBe('none !important');
    expect(css).toContain('@keyframes dz-fade-in');
  });
});
