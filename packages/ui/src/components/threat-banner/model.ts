/** ThreatBanner rules (spec §3.3, Designer answers 8 and final fix 2). */

export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';
export const THREAT_LEVELS = [
  'low',
  'medium',
  'high',
  'critical',
] as const satisfies readonly ThreatLevel[];

const RANK: Record<ThreatLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Level names in normal case (uppercased by CSS). `low` has no banner. */
export const THREAT_LABELS: Record<Exclude<ThreatLevel, 'low'>, string> = {
  medium: 'średni',
  high: 'wysoki',
  critical: 'krytyczny',
};

export const threatText = (level: Exclude<ThreatLevel, 'low'>): string =>
  `Poziom zagrożenia: ${THREAT_LABELS[level]}`;

export const isRise = (from: ThreatLevel, to: ThreatLevel): boolean => RANK[to] > RANK[from];
