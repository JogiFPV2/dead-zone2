import { Mesh, type AnimationClip, type MeshStandardMaterial, type Object3D } from 'three';
import { PLAYER_HEIGHT } from '../player/player-view.js';
import { ZOMBIE_MODELS, type ModelKit } from './model-kit.js';

/** Sickly skin for zombies (placeholder tint over the Quaternius characters). */
const ZOMBIE_SKIN = 0x6f8a5a;
/**
 * Self-lit share of the base colour so characters read at default zoom (subtle: the night
 * vignette and lighting still dominate).
 */
export const CHARACTER_EMISSIVE = 0.22;

/** Clones every material of `o` and applies `edit` (per character template, not per instance). */
function editMaterials(o: Object3D, edit: (m: MeshStandardMaterial) => void): void {
  o.traverse((m) => {
    if (!(m instanceof Mesh)) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[];
    const next = mats.map((mat) => {
      const c = mat.clone();
      edit(c);
      return c;
    });
    m.material = Array.isArray(m.material) ? next : next[0]!;
  });
}

/** Subtle self-lighting so the character stays readable. */
export function brighten(o: Object3D, amount = CHARACTER_EMISSIVE): void {
  editMaterials(o, (m) => {
    m.emissive.copy(m.color);
    m.emissiveIntensity = amount;
  });
}

/** Zombie look: greenish skin, darker clothes, then the same subtle self-lighting. */
export function tintZombie(o: Object3D): void {
  editMaterials(o, (m) => {
    if (/skin/i.test(m.name)) m.color.setHex(ZOMBIE_SKIN);
    else m.color.multiplyScalar(0.7);
    m.emissive.copy(m.color);
    m.emissiveIntensity = CHARACTER_EMISSIVE;
  });
}

/** Zombie character templates (object + clips), tinted. */
export async function loadZombieTemplates(
  kit: ModelKit,
): Promise<{ object: Object3D; clips: AnimationClip[] }[]> {
  const out: { object: Object3D; clips: AnimationClip[] }[] = [];
  for (const id of ZOMBIE_MODELS) {
    try {
      const t = await kit.character(id, PLAYER_HEIGHT);
      tintZombie(t.object);
      out.push(t);
    } catch (e) {
      console.warn(`zombie model ${id}`, e);
    }
  }
  return out;
}
