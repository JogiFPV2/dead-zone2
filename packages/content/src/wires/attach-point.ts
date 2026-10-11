import type { AttachFile, AttachPoint } from './attach-file.js';
import type { WireId } from './wire-ids.js';

/** Punkt zaczepienia o danym `id` albo `undefined`, gdy słup go nie ma (np. `GW` na 110 kV bez odgromowego). */
export function attachPoint(file: AttachFile, id: WireId): AttachPoint | undefined {
  return file.attach.find((p) => p.id === id);
}
