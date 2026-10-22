// Empacota um worker TypeScript em .cjs temporário para testes que precisam de processos reais.
import { buildSync } from 'esbuild';
import path from 'node:path';

export function bundleWorker(entry: string, outDir: string, name = path.basename(entry, '.ts')): string {
  const outfile = path.join(outDir, `${name}.cjs`);
  buildSync({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent', external: ['electron'] });
  return outfile;
}
