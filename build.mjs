// Build com esbuild: node build.mjs [--watch]
// (tipos são checados à parte com `npm run typecheck`)
import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';

const watch = process.argv.includes('--watch');
const STATIC = ['index.html', 'style.css', 'companion.html', 'companion.css'];

const common = { bundle: true, logLevel: 'info', sourcemap: 'linked' };
const node = { ...common, platform: 'node', target: 'node22', packages: 'external' };

const builds = [
  { ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', format: 'cjs' },
  { ...node, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js', format: 'cjs' },
  { ...node, entryPoints: ['src/preload/companion-preload.ts'], outfile: 'dist/companion-preload.js', format: 'cjs' },
  { ...common, platform: 'browser', target: 'chrome130', entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js', format: 'iife' },
  { ...common, platform: 'browser', target: 'chrome130', entryPoints: ['src/renderer/companion.ts'], outfile: 'dist/renderer/companion.js', format: 'iife' },
  { ...node, entryPoints: ['scripts/demo.ts'], outfile: 'dist/scripts/demo.js', format: 'cjs' },
  { ...node, entryPoints: ['scripts/import-skin.ts'], outfile: 'dist/scripts/import-skin.js', format: 'cjs' },
];

async function copyStatic() {
  await mkdir('dist/renderer', { recursive: true });
  await Promise.all(STATIC.map((f) => copyFile(`src/renderer/${f}`, `dist/renderer/${f}`)));
}

if (!watch) await rm('dist', { recursive: true, force: true });
await copyStatic();

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  fsWatch('src/renderer', (_event, file) => {
    if (file && STATIC.includes(file)) copyStatic().catch(console.error);
  });
  console.log('[build] observando mudanças...');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
