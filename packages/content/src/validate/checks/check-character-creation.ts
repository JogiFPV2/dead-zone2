import type { Appearance } from '../../schemas/character-creation.js';
import type { WorldSettings } from '../../schemas/world-settings.js';
import type { ContentIndex } from '../content-index.js';
import type { ContentErrorCode, ErrorSink } from '../errors.js';
import { formatJsonPath } from '../json-path.js';
import type { SourceRef } from '../source.js';

/**
 * `worldSettings.characterCreation`: koszty spójne (jeden koszt na poziom do
 * `maxSkillLevelAtStart`, niemalejące; `startPoints` + najmocniejszy zawód ≥ 0; minLen ≤ maxLen)
 * i (gdy są palety) wygląd startowy wskazuje istniejące części właściwych slotów i kolory z ich palet.
 */
export function checkCharacterCreation(
  index: ContentIndex,
  ws: WorldSettings,
  where: SourceRef,
  sink: ErrorSink,
): void {
  const cc = ws.characterCreation;
  const err = (code: ContentErrorCode, message: string, ...p: (string | number)[]) =>
    sink.add({
      code,
      message,
      pack: where.pack,
      file: where.file,
      path: formatJsonPath([...where.path, 'characterCreation', ...p]),
    });
  const cost = cc.skillPointCost;
  if (cost.length !== cc.maxSkillLevelAtStart)
    err(
      'creation_cost_invalid',
      `skillPointCost ma ${cost.length} pozycji, a maks. poziom to ${cc.maxSkillLevelAtStart}`,
      'skillPointCost',
    );
  if (cost.some((c, i) => i > 0 && c < cost[i - 1]!))
    err('creation_cost_invalid', 'koszt kolejnego poziomu nie może maleć', 'skillPointCost');
  if (cc.name.minLen > cc.name.maxLen)
    err('creation_cost_invalid', 'name.minLen większe niż maxLen', 'name', 'minLen');
  for (const p of index.map('profession').values())
    if (cc.startPoints + p.data.points < 0)
      err(
        'creation_cost_invalid',
        `zawód „${p.id}” (${p.data.points}) daje ujemną pulę przy startPoints ${cc.startPoints}`,
        'startPoints',
      );

  const palettes = index.map('palette');
  const skin = palettes.get(cc.skinPalette)?.data;
  if (palettes.size === 0 && !cc.defaultAppearance) return;
  if (!skin || skin.kind !== 'skin')
    err('creation_default_invalid', `„${cc.skinPalette}” nie jest paletą skóry`, 'skinPalette');
  const def: Appearance | undefined = cc.defaultAppearance;
  if (!def) return;
  if (skin && !skin.colors.some((c) => c.id === def.skin))
    err(
      'creation_default_invalid',
      `kolor skóry „${def.skin}” nie istnieje`,
      'defaultAppearance',
      'skin',
    );
  for (const [slot, choice] of Object.entries(def.parts)) {
    if (!choice) continue;
    const at = ['defaultAppearance', 'parts', slot];
    const part = index.map('appearancePart').get(choice.part)?.data;
    if (!part || part.slot !== slot) {
      err(
        'creation_default_invalid',
        `„${choice.part}” nie jest częścią slotu ${slot}`,
        ...at,
        'part',
      );
      continue;
    }
    for (const t of part.tints) {
      const color = choice.colors[t.channel];
      const ok = palettes.get(t.palette)?.data.colors.some((c) => c.id === color);
      if (!ok)
        err(
          'creation_default_invalid',
          `kanał ${t.channel}: brak koloru „${color ?? ''}” w „${t.palette}”`,
          ...at,
          'colors',
        );
    }
  }
}
