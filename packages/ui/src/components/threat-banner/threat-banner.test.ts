// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { declsFor, keyframes, readCss, v } from '../../test/css.js';
import { createThreatBanner, isRise, THREAT_LEVELS, threatText } from './index.js';

const css = readCss('components/threat-banner/threat-banner.css');
const reduced = readCss('styles/reduced-motion.css');
const sel = (level: string) => `.dz-threat[data-level='${level}']`;

describe('ThreatBanner states (spec §3.3)', () => {
  it('low hides the banner; the other levels show the Polish label', () => {
    const b = createThreatBanner({ level: 'low' }, document);
    expect(b.el.hidden).toBe(true);
    expect(b.el.getAttribute('role')).toBe('status');
    for (const level of ['medium', 'high', 'critical'] as const) {
      b.update({ level });
      expect(b.el.hidden).toBe(false);
      expect(b.el.dataset.level).toBe(level);
      expect(b.el.querySelector('.dz-threat__label')?.textContent).toBe(threatText(level));
    }
    expect(threatText('critical')).toBe('Poziom zagrożenia: krytyczny');
    expect(THREAT_LEVELS).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('enters from low and flashes when the level rises', () => {
    const b = createThreatBanner({ level: 'low' }, document);
    b.update({ level: 'medium' });
    expect(b.el.dataset.enter).toBeDefined();
    b.update({ level: 'critical' });
    expect(b.el.dataset.flash).toBeDefined();
    expect(isRise('high', 'medium')).toBe(false);
  });

  it('uses the level tokens', () => {
    expect(declsFor(css, sel('medium'))).toMatchObject({
      '--_bg': v('color.warning.banner'),
      '--_fg': v('color.text.inverse'),
    });
    expect(declsFor(css, sel('high'))).toMatchObject({
      '--_bg': v('color.threat.high.bg'),
      '--_fg': v('color.threat.high.text'),
    });
    expect(declsFor(css, sel('critical'))).toEqual({
      '--_bg': v('color.threat.critical.bg'),
      '--_fg': v('color.threat.critical.text'),
      '--_border': v('color.threat.critical.border'),
    });
    const base = declsFor(css, '.dz-threat');
    expect(base.height).toBe(v('size.banner'));
    expect(base['pointer-events']).toBe('none');
    expect(declsFor(css, '.dz-threat::before').background).toBe('var(--_bg)');
  });

  it('only critical pulses (background opacity 1 ↔ motion.pulse.threat)', () => {
    expect(declsFor(css, `${sel('critical')}::before`).animation).toBe(
      'dz-threat-pulse var(--motion-pulse-duration) ease-in-out infinite alternate',
    );
    expect(declsFor(css, `${sel('high')}::before`)).toEqual({});
    expect(keyframes(css)).toContain('dz-threat-pulse');
    expect(css).toMatch(/opacity: var\(--motion-pulse-threat\)/);
  });

  it('has a hidden "!!" badge that reduced motion shows instead of the pulse', () => {
    const b = createThreatBanner({ level: 'critical' }, document);
    const alert = b.el.querySelector('.dz-threat__alert');
    expect(alert?.textContent).toBe('!!');
    expect(alert?.getAttribute('aria-hidden')).toBe('true');
    expect(declsFor(css, '.dz-threat__alert').display).toBe('none');
    expect(declsFor(reduced, '.dz-reduced-motion .dz-threat::before').animation).toBe(
      'none !important',
    );
    expect(
      declsFor(reduced, ".dz-reduced-motion .dz-threat[data-level='critical'] .dz-threat__alert")
        .display,
    ).toBe('inline-flex !important');
    expect(
      declsFor(
        reduced,
        ".dz-threat[data-level='critical']:not(.dz-full-motion *) .dz-threat__alert",
      ).display,
    ).toBe('inline-flex !important');
  });
});
