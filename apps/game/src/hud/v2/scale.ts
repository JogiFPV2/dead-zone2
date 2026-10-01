/** HUD v2 reference viewport (deadzone-hud-v2-spec §1, §10). */
export const HUD2_REF_WIDTH = 1280;
export const HUD2_REF_HEIGHT = 720;

/** `clamp(0.8, min(w/1280, h/720), 1.5) × setting`, rounded to 0.05 (spec §10). */
export function hud2Scale(width: number, height: number, setting = 1): number {
  const base = Math.min(
    1.5,
    Math.max(0.8, Math.min(width / HUD2_REF_WIDTH, height / HUD2_REF_HEIGHT)),
  );
  return Math.round((base * setting) / 0.05) * 0.05;
}
