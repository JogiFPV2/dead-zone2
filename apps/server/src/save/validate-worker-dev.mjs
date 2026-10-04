// Dev/test bootstrap: runs the TypeScript worker through tsx (production uses the built .js).
import { tsImport } from 'tsx/esm/api';

await tsImport('./validate-worker.ts', import.meta.url);
