// Servidor estático da página de inspeção do rig (só desenvolvimento, só 127.0.0.1).
//   node build.mjs && node dist/scripts/rig-inspect-server.js   →  http://127.0.0.1:4180/
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.RIG_INSPECT_PORT) || 4180;
const ROOT = path.resolve(__dirname, '..', '..'); // dist/scripts → raiz do repo

const ROUTES: [prefix: string, dir: string][] = [
  ['/skins/', path.join(ROOT, 'dev', 'skins')],
  ['/', path.join(ROOT, 'dist', 'scripts', 'rig-inspect')],
];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.map': 'application/json',
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  const route = ROUTES.find(([prefix]) => url.startsWith(prefix));
  if (!route) return void res.writeHead(404).end();
  const [prefix, dir] = route;
  const file = path.resolve(dir, `.${url.slice(prefix.length - 1)}${url.endsWith('/') ? 'index.html' : ''}`);
  // não deixa sair da pasta servida
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`[rig] inspeção em http://127.0.0.1:${PORT}/`));
