/**
 * Ustawienia › Interfejs: preview of the noise circle for the chosen „Pokazuj hałas” option
 * (settings-noise.png). A still of the game (public/ui/noise-preview.webp, captured at
 * `PREVIEW_PX_PER_M`, player in the middle) with the ring drawn in SVG using the in-game look.
 */
import { NOISE_LOOK, NOISE_UNDERLAY, noiseTier } from '../hud/noise/noise-model.js';
import type { NoiseDisplay } from '../settings/schema.js';

export const PREVIEW_W = 380;
export const PREVIEW_H = 214;
/** Scale of the still (px per m): the game camera at a 57.6 m view height, 720 px tall. */
export const PREVIEW_PX_PER_M = 12.5;
/** Iso pitch 35°: a ground circle is an ellipse with ry = r · sin 35°. */
const SQUASH = Math.sin((35 * Math.PI) / 180);

/** Which noise the preview shows per option: run (12 m) for loud, walk (5 m) for always. */
const SAMPLE: Record<
  Exclude<NoiseDisplay, 'off'>,
  { label: string; r: number; loudness: number }
> = {
  loud: { label: 'BIEG', r: 12, loudness: 0.5 },
  always: { label: 'CHÓD', r: 5, loudness: 0.25 },
};

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export function noisePreview(display: NoiseDisplay): string {
  const cx = PREVIEW_W / 2;
  const cy = PREVIEW_H / 2;
  let ring = '';
  let tag = 'WYŁ. · brak okręgu';
  if (display !== 'off') {
    const s = SAMPLE[display];
    const look = NOISE_LOOK[noiseTier(s.loudness)];
    const rx = s.r * PREVIEW_PX_PER_M;
    const ry = rx * SQUASH;
    const c = hex(look.color);
    ring =
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${c}" fill-opacity="${look.fill}" stroke="#000" stroke-opacity="${NOISE_UNDERLAY.alpha}" stroke-width="${NOISE_UNDERLAY.widthPx}"/>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${c}" stroke-opacity="${look.stroke}" stroke-width="${look.widthPx}"/>`;
    tag = `<b style="color:${c}">${s.label}</b> · ${String(s.r).replace('.', ',')} m`;
  }
  const src = `${import.meta.env.BASE_URL}ui/noise-preview.webp`;
  return `<aside class="dzo-preview" aria-label="Podgląd okręgu hałasu"><div class="dzo-preview-box" style="background-image:url('${src}')"><span class="dzo-preview-badge">PODGLĄD</span><svg viewBox="0 0 ${PREVIEW_W} ${PREVIEW_H}" width="${PREVIEW_W}" height="${PREVIEW_H}" aria-hidden="true">${ring}</svg><span class="dzo-preview-tag">${tag}</span></div><p class="dzo-preview-note">Okrąg pojawia się po akcji i znika po ok. 2 s.<br>Ledwo widoczny, bez podpisów: tylko zasięg ostatniej akcji.</p></aside>`;
}
