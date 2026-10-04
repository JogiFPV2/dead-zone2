// @deadzone/ui/settings — player settings + HUD layout: zod schemas, defaults, pure functions.
// No DOM: safe for the server / Edge Functions. Only depends on `zod` (checked by
// tsconfig.settings.json without the DOM lib and by settings-entry.test.ts).
export * from '../hud-layout/index.js';
export * from './player-settings.js';
export * from './resolve.js';
