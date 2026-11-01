// Build com esbuild: node build.mjs [--watch]
//   dist/cli.js          o comando tera-skin (Node)
//   dist/render-main.js  o Electron escondido que desenha as prévias (tera-skin render)
//   dist/web/            o Studio (navegador) e a página de render
import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const STATIC = ['index.html', 'studio.css', 'render.html'];
const common = { bundle: true, logLevel: 'warning', sourcemap: 'linked' };
const node = { ...common, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'] };
const web = { ...common, platform: 'browser', target: 'chrome130', format: 'iife' };

const builds = [
  { ...node, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', banner: { js: '#!/usr/bin/env node' } },
  { ...node, entryPoints: ['src/render-main.ts'], outfile: 'dist/render-main.js' },
  { ...web, entryPoints: ['src/web/studio.ts'], outfile: 'dist/web/studio.js' },
  { ...web, entryPoints: ['src/web/render-page.ts'], outfile: 'dist/web/render-page.js' },
];

if (!watch) await rm('dist', { recursive: true, force: true });
await mkdir('dist/web', { recursive: true });
await Promise.all(STATIC.map((f) => copyFile(`web/${f}`, `dist/web/${f}`)));

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[build] observando mudanças...');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
