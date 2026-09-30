import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5174 },
  // three.js alone is ~500 kB minified; budget is tracked separately (PLAN.md).
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
