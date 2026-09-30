import type { Action, InputCode } from '../input/actions.js';
import { rebind, type ConflictPolicy, type RebindResult } from '../input/bindings.js';
import type { SettingsStore } from './store.js';

/** Rebinding API for the future settings screen: validates, detects conflicts, persists. */
export function rebindAction(
  store: SettingsStore,
  action: Action,
  code: InputCode,
  opts: { slot?: number; policy?: ConflictPolicy } = {},
): RebindResult {
  const r = rebind(store.get().input.bindings, action, code, opts);
  if (r.ok) store.update((s) => ({ ...s, input: { ...s.input, bindings: r.bindings } }));
  return r;
}
