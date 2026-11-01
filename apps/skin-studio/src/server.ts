// Servidor do Skin Studio (`tera-skin studio <pasta>`): só 127.0.0.1, uma pasta de skin
// por vez. Serve o editor, os arquivos da skin e uma API pequena pra validar e salvar o
// rig.json e adicionar partes. Avisa o editor quando algo muda na pasta (ex.: o Codex
// editou o rig.json), pra os dois trabalharem juntos.
//
// Segurança: só aceita quem tem o token da URL aberta pelo comando (outra página no
// navegador não consegue salvar nada), confere Host/Origin (DNS rebinding) e nunca sai
// da pasta da skin.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { isSafeImagePath } from '@tera/character/rig';
import { pngSize } from '@tera/skin-kit/png';
import { validateSkinDir } from '@tera/skin-kit/validate';
import type { SkinFile, SkinState } from './studio-api';

const MAX_JSON = 2 * 1024 * 1024;
const MAX_PNG = 20 * 1024 * 1024;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.map': 'application/json',
};

export interface StudioOptions {
  /** Pasta da skin */
  dir: string;
  /** Pasta do editor já compilado (dist/web) */
  webDir: string;
  /** 0 = qualquer porta livre */
  port?: number;
  token?: string;
}

export interface StudioServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

/** Todos os PNGs da pasta, com tamanho (as prévias renderizadas ficam de fora) */
export function listParts(dir: string): SkinFile[] {
  const out: SkinFile[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (rel !== 'previews') walk(full);
      } else if (e.name.toLowerCase().endsWith('.png')) {
        const size = pngSize(fs.readFileSync(full));
        if (size) out.push({ path: rel, ...size });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Estado da skin pro editor: manifesto, rig cru (como está no arquivo), partes e relatório */
export function skinState(dir: string): SkinState {
  const skin = JSON.parse(fs.readFileSync(path.join(dir, 'skin.json'), 'utf8')) as Record<string, unknown>;
  const rigFile = typeof skin.rig === 'string' ? skin.rig : 'rig.json';
  let rig: unknown = null;
  try { rig = JSON.parse(fs.readFileSync(path.join(dir, rigFile), 'utf8')); } catch { rig = null; }
  return {
    name: typeof skin.name === 'string' ? skin.name : path.basename(dir),
    size: typeof skin.size === 'number' ? skin.size : 260,
    facing: skin.facing === 'left' ? 'left' : 'right',
    rigFile,
    rig,
    files: listParts(dir),
    report: validateSkinDir(dir),
  };
}

function readBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('grande demais'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const json = (res: http.ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
};

/** Arquivo dentro de `root` (ou null se o caminho tentar sair dela) */
function inside(root: string, rel: string): string | null {
  const file = path.resolve(root, rel);
  return file.startsWith(root + path.sep) ? file : null;
}

export function startStudio(opts: StudioOptions): Promise<StudioServer> {
  const dir = path.resolve(opts.dir);
  const webDir = path.resolve(opts.webDir);
  const token = opts.token ?? crypto.randomBytes(16).toString('hex');
  const listeners = new Set<http.ServerResponse>();
  let port = 0;
  let backedUp = false;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return void res.writeHead(403).end();
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return void res.writeHead(403).end();

    // ---------- API (com token) ----------
    if (url.pathname.startsWith('/api/')) {
      const given = req.headers['x-tera-token'] ?? url.searchParams.get('t');
      if (given !== token) return json(res, 401, { error: 'token inválido' });
      try {
        if (req.method === 'GET' && url.pathname === '/api/skin') return json(res, 200, skinState(dir));
        if (req.method === 'POST' && url.pathname === '/api/validate') {
          const rig = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8')) as unknown;
          return json(res, 200, validateSkinDir(dir, rig));
        }
        if (req.method === 'PUT' && url.pathname === '/api/rig') {
          const rig = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8')) as unknown;
          const report = validateSkinDir(dir, rig);
          // com erro a Tera nem carregaria: não grava
          if (!report.ok) return json(res, 422, report);
          const file = path.join(dir, report.rigFile ?? 'rig.json');
          if (!backedUp && fs.existsSync(file)) {
            fs.copyFileSync(file, `${file}.bak`);
            backedUp = true;
          }
          fs.writeFileSync(file, `${JSON.stringify(rig, null, 2)}\n`);
          return json(res, 200, report);
        }
        if (req.method === 'POST' && url.pathname === '/api/parts') {
          const rel = url.searchParams.get('file') ?? '';
          const file = isSafeImagePath(rel) ? inside(dir, rel) : null;
          if (!file) return json(res, 400, { error: 'nome de arquivo inválido (um .png dentro da pasta da skin)' });
          if (fs.existsSync(file) && url.searchParams.get('overwrite') !== '1') return json(res, 409, { error: `${rel} já existe` });
          const body = await readBody(req, MAX_PNG);
          const size = pngSize(body);
          if (!size) return json(res, 400, { error: 'o arquivo não é um PNG' });
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, body);
          return json(res, 200, { path: rel, ...size });
        }
        if (req.method === 'GET' && url.pathname === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(': ok\n\n');
          listeners.add(res);
          req.on('close', () => listeners.delete(res));
          return;
        }
        return json(res, 404, { error: 'rota desconhecida' });
      } catch (err) {
        return json(res, 400, { error: (err as Error).message });
      }
    }

    if (req.method !== 'GET') return void res.writeHead(405).end();
    // ---------- arquivos da skin ----------
    if (url.pathname.startsWith('/skin/')) {
      const rel = decodeURIComponent(url.pathname.slice('/skin/'.length));
      const file = inside(dir, rel);
      if (!file || !/\.(png|json)$/i.test(file) || !fs.existsSync(file)) return void res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()]!, 'Cache-Control': 'no-store' });
      return void fs.createReadStream(file).pipe(res);
    }
    // ---------- o editor ----------
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = inside(webDir, rel);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return void res.writeHead(404).end();
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:",
    });
    fs.createReadStream(file).pipe(res);
  });

  // mudou algo na pasta (o Codex salvou, uma parte nova): avisa o editor
  let timer: NodeJS.Timeout | undefined;
  const watcher = fs.watch(dir, { recursive: true }, (_ev, name) => {
    if (!name || String(name).endsWith('.bak') || String(name).startsWith('previews')) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const l of listeners) l.write(`event: change\ndata: ${JSON.stringify({ file: String(name).split(path.sep).join('/') })}\n\n`);
    }, 150);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/?t=${token}`,
        port,
        token,
        close: () => new Promise((done) => {
          watcher.close();
          for (const l of listeners) l.end();
          server.close(() => done());
        }),
      });
    });
  });
}
