// Bundle da POC com o esbuild do projeto raiz. O SDK fica externo (é ESM e carregado com import()).
import { build } from 'esbuild';
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true, external: ['electron', '@anthropic-ai/claude-agent-sdk'], logLevel: 'warning' };
await build({ ...common, entryPoints: ['src/smoke.ts'], outfile: 'dist/smoke.js' });
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.js' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.js' });
