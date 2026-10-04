import { z } from 'zod';
import { HUD_LAYOUT_SLOTS, type HudLayoutSlot } from './ids.js';

export const HUD_LAYOUT_VERSION = 1;

/** Screen corner / edge the element is pinned to: t/c/b (vertical) + l/c/r (horizontal). */
export const HUD_ANCHORS = ['tl', 'tc', 'tr', 'cl', 'cr', 'bl', 'bc', 'br'] as const;
export type HudAnchor = (typeof HUD_ANCHORS)[number];

export const HUD_SCALE_MIN = 0.5;
export const HUD_SCALE_MAX = 1.5;
export const HUD_OPACITY_MIN = 0.2;
export const HUD_OPACITY_MAX = 1;

/** Horizontal axis is centred for 'tc' / 'bc', vertical for 'cl' / 'cr'. */
export function anchorAxes(anchor: HudAnchor): { h: 'l' | 'c' | 'r'; v: 't' | 'c' | 'b' } {
  const v = anchor[0] as 't' | 'c' | 'b';
  const h = anchor[1] as 'l' | 'c' | 'r';
  return { h, v };
}

/**
 * One element. `x` / `y` are the offset from the anchor edge as a fraction of the screen
 * (0..1). On a centred axis the value is a signed shift of the element centre from the screen
 * centre (−0.5..0.5). `scale` multiplies the global UI scale.
 */
export const hudElementLayoutSchema = z
  .object({
    anchor: z.enum(HUD_ANCHORS),
    x: z.number().finite().min(-0.5).max(1),
    y: z.number().finite().min(-0.5).max(1),
    scale: z.number().finite().min(HUD_SCALE_MIN).max(HUD_SCALE_MAX),
    opacity: z.number().finite().min(HUD_OPACITY_MIN).max(HUD_OPACITY_MAX),
    visible: z.boolean().default(true),
  })
  .superRefine((el, ctx) => {
    const { h, v } = anchorAxes(el.anchor);
    const check = (axis: 'x' | 'y', centred: boolean): void => {
      const val = el[axis];
      const ok = centred ? val >= -0.5 && val <= 0.5 : val >= 0 && val <= 1;
      if (!ok) {
        ctx.addIssue({
          code: 'custom',
          path: [axis],
          message: centred ? `${axis} poza −0.5..0.5 (oś środkowa)` : `${axis} poza 0..1`,
        });
      }
    };
    check('x', h === 'c');
    check('y', v === 'c');
  });

export type HudElementLayout = z.output<typeof hudElementLayoutSchema>;
export type HudElementLayoutInput = z.input<typeof hudElementLayoutSchema>;

const elementsShape = Object.fromEntries(
  HUD_LAYOUT_SLOTS.map((id) => [id, hudElementLayoutSchema.optional()]),
) as { [K in HudLayoutSlot]: z.ZodOptional<typeof hudElementLayoutSchema> };

/**
 * Saved layout (player settings, local and cloud). `elements` holds only the elements the
 * player changed; unknown ids (e.g. from a newer client) are stripped, keys are layout
 * slots (`HUD_LAYOUT_SLOTS`, `vehicle` uses `weapon`), they, not rejected.
 */
export const hudLayoutSchema = z.object({
  version: z.literal(HUD_LAYOUT_VERSION),
  elements: z.object(elementsShape),
});

export type HudLayout = z.output<typeof hudLayoutSchema>;
export type HudLayoutInput = z.input<typeof hudLayoutSchema>;

/** Layout with an entry for every element (what the HUD renders). */
export interface ResolvedHudLayout {
  version: typeof HUD_LAYOUT_VERSION;
  elements: Record<HudLayoutSlot, HudElementLayout>;
}
