// Build com esbuild: node build.mjs [--watch]
// (tipos são checados à parte com `npm run typecheck`)
import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';

const watch = process.argv.includes('--watch');
const STATIC = ['index.html', 'style.css', 'panel.html', 'panel.css'];

const common = { bundle: true, logLevel: 'info', sourcemap: 'linked' };
// Ficam de fora do bundle: o Electron, o Agent SDK (ESM com import.meta, carregado sob
// demanda) e o node-pty (módulo nativo); os dois últimos vão pro pacote como dependência. O resto (zod, MCP SDK e os
// pacotes do workspace) entra no bundle.
const node = { ...common, platform: 'node', target: 'node22', external: ['electron', '@anthropic-ai/claude-agent-sdk', 'node-pty'] };

const builds = [
  { ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js', format: 'cjs' },
  { ...node, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js', format: 'cjs' },
  { ...node, entryPoints: ['src/preload/panel-preload.ts'], outfile: 'dist/panel-preload.js', format: 'cjs' },
  { ...common, platform: 'browser', target: 'chrome130', entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js', format: 'iife' },
  { ...common, platform: 'browser', target: 'chrome130', entryPoints: ['src/renderer/panel.ts'], outfile: 'dist/renderer/panel.js', format: 'iife' },
  { ...node, entryPoints: ['scripts/agent-smoke.ts'], outfile: 'dist/scripts/agent-smoke.js', format: 'cjs' },
  { ...node, entryPoints: ['scripts/demo.ts'], outfile: 'dist/scripts/demo.js', format: 'cjs' },
  { ...node, entryPoints: ['scripts/import-skin.ts'], outfile: 'dist/scripts/import-skin.js', format: 'cjs' },
  // só desenvolvimento (dist/scripts fica fora do instalador): rig experimental
  { ...node, entryPoints: ['scripts/make-rig-placeholders.ts'], outfile: 'dist/scripts/make-rig-placeholders.js', format: 'cjs' },
  { ...node, entryPoints: ['scripts/rig-inspect/server.ts'], outfile: 'dist/scripts/rig-inspect-server.js', format: 'cjs' },
  { ...common, platform: 'browser', target: 'chrome130', entryPoints: ['scripts/rig-inspect/inspect.ts'], outfile: 'dist/scripts/rig-inspect/inspect.js', format: 'iife' },
];

async function copyStatic() {
  await mkdir('dist/renderer', { recursive: true });
  await Promise.all(STATIC.map((f) => copyFile(`src/renderer/${f}`, `dist/renderer/${f}`)));
  await copyFile('node_modules/@xterm/xterm/css/xterm.css', 'dist/renderer/xterm.css');
  await mkdir('dist/scripts/rig-inspect', { recursive: true });
  await copyFile('scripts/rig-inspect/index.html', 'dist/scripts/rig-inspect/index.html');
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
