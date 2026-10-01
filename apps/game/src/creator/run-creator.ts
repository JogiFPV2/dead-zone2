import type { AudioEngine } from '../audio/audio-engine.js';
import { loadCreatorContent } from './creator-content.js';
import type { CreatorPreview } from './creator-preview.js';
import { createCreatorScreen, type CreatorResult } from './creator-screen.js';

export interface RunCreatorOptions {
  root: HTMLElement;
  modeLabel: string;
  audio?: AudioEngine | undefined;
  step?: number | undefined;
}

/**
 * Shows the character creator; resolves with the character, or undefined on cancel (Esc). The
 * 3D preview is optional: without WebGL the creator still works (tiles without thumbnails).
 */
export async function runCreator(o: RunCreatorOptions): Promise<CreatorResult | undefined> {
  const [content, preview] = await Promise.all([
    loadCreatorContent(),
    import('./creator-preview.js')
      .then((m) => m.createCreatorPreview())
      .catch((e: unknown): CreatorPreview | undefined => {
        console.warn('Kreator: brak podglądu 3D', e);
        return undefined;
      }),
  ]);
  const sounds = { click: 'ui-click1', hover: 'ui-rollover2', switch: 'ui-switch2' } as const;
  try {
    return await new Promise<CreatorResult | undefined>((resolve) => {
      createCreatorScreen({
        root: o.root,
        content,
        modeLabel: o.modeLabel,
        preview,
        ...(o.step !== undefined ? { step: o.step } : {}),
        sound: (id) => o.audio?.play('ui', sounds[id]),
        onDone: resolve,
      });
    });
  } finally {
    preview?.dispose();
  }
}
