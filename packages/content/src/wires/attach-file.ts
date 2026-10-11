import { z } from 'zod';
import { POLE_KINDS, WIRE_IDS, WIRE_RULES, type PoleKind, type WireId } from './wire-ids.js';

/**
 * Punkt zaczepienia przewodu w metrach względem podstawy słupa.
 * y w górę (> 0), słup stoi wzdłuż osi x (w poprzek linii), z wzdłuż linii.
 * zod v4: `z.number()` odrzuca NaN i ±Infinity.
 */
export const attachPointSchema = z.strictObject({
  id: z.enum(WIRE_IDS),
  x: z.number(),
  y: z.number().positive(),
  z: z.number(),
});

/** Id modelu: to samo co nazwa pliku modelu bez rozszerzenia (`<modelId>.attach.json`). */
export const poleModelIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

function checkIds(kind: PoleKind, ids: readonly WireId[], ctx: z.RefinementCtx): void {
  const rule = WIRE_RULES[kind];
  const allowed = new Set<WireId>([...rule.required, ...rule.optional]);
  const seen = new Set<WireId>();
  ids.forEach((id, i) => {
    const path = ['attach', i, 'id'];
    if (seen.has(id)) ctx.addIssue({ code: 'custom', path, message: `powtórzone id ${id}` });
    else if (!allowed.has(id))
      ctx.addIssue({ code: 'custom', path, message: `id ${id} niedozwolone dla ${kind}` });
    seen.add(id);
  });
  for (const id of rule.required) {
    if (!seen.has(id)) ctx.addIssue({ code: 'custom', path: ['attach'], message: `brak ${id}` });
  }
  const group = rule.allOrNone ?? [];
  const present = group.filter((id) => seen.has(id)).length;
  if (present > 0 && present < group.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['attach'],
      message: `${group.join(', ')}: wszystkie albo żaden`,
    });
  }
  for (const [id, need] of Object.entries(rule.requires ?? {}) as [WireId, WireId][]) {
    if (seen.has(id) && !seen.has(need)) {
      ctx.addIssue({
        code: 'custom',
        path: ['attach'],
        message: `${id} tylko razem z ${need}`,
      });
    }
  }
}

/** Plik `<modelId>.attach.json` obok modelu słupa. */
export const attachFileSchema = z
  .strictObject({
    modelId: poleModelIdSchema,
    kind: z.enum(POLE_KINDS),
    attach: z.array(attachPointSchema).min(1),
  })
  .superRefine((f, ctx) =>
    checkIds(
      f.kind,
      f.attach.map((p) => p.id),
      ctx,
    ),
  );

export type AttachPoint = z.infer<typeof attachPointSchema>;
export type AttachFile = z.infer<typeof attachFileSchema>;
