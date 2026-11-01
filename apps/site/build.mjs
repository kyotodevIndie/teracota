// Build do site: node build.mjs [--serve]
//   dist/            a página (index.html, site.css, site.js)
//   dist/tera/       o rig da Tera (copiado de assets/skins/tera-rig) e os ícones
// A documentação (VitePress) entra em dist/docs no deploy (pnpm site:build na raiz).
import * as esbuild from 'esbuild';
import { cp, mkdir, rm, copyFile } from 'node:fs/promises';

const serve = process.argv.includes('--serve');
const opts = {
  entryPoints: ['src/site.ts'],
  outfile: 'dist/site.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'safari16', 'firefox115'],
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  logLevel: 'warning',
};

await rm('dist', { recursive: true, force: true });
await mkdir('dist/tera', { recursive: true });
await Promise.all([
  copyFile('index.html', 'dist/index.html'),
  copyFile('site.css', 'dist/site.css'),
  cp('../../assets/skins/tera-rig', 'dist/tera/rig', { recursive: true, filter: (f) => !f.includes('previews') && !f.endsWith('.bak') }),
  copyFile('../../docs/public/favicon.png', 'dist/favicon.png'),
  copyFile('../../docs/public/og.png', 'dist/og.png'),
]);

if (serve) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 4321, host: '127.0.0.1' });
  console.log(`site em http://127.0.0.1:${port}/`);
} else {
  await esbuild.build(opts);
}
