import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Basis Universal transcoder for KTX2Loader, served at /basis/ in dev and copied at build. */
function basisTranscoder(): Plugin {
  const require = createRequire(import.meta.url);
  const dir = dirname(require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js'));
  const files = ['basis_transcoder.js', 'basis_transcoder.wasm'];
  return {
    name: 'deadzone-basis-transcoder',
    configureServer(server) {
      server.middlewares.use('/basis', (req, res, next) => {
        const file = (req.url ?? '').replace(/^\//, '').split('?')[0] ?? '';
        if (!files.includes(file)) return next();
        res.setHeader(
          'Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        );
        res.end(readFileSync(join(dir, file)));
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: `basis/${file}`,
          source: readFileSync(join(dir, file)),
        });
      }
    },
  };
}

export default defineConfig({
  server: { port: 5174 },
  plugins: [basisTranscoder()],
  // three.js alone is ~500 kB minified; budget is tracked separately (PLAN.md).
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
