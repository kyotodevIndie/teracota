import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSkin } from '@tera/skin-kit/scaffold';
import { type StudioServer, startStudio } from './server';

const TEMPLATE = path.resolve(__dirname, '..', '..', '..', 'assets', 'skins', 'tera-rig');
let dir: string;
let web: string;
let studio: StudioServer;

beforeEach(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tera-studio-'));
  dir = path.join(tmp, 'skin');
  web = path.join(tmp, 'web');
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(web, 'index.html'), '<h1>studio</h1>');
  fs.writeFileSync(path.join(tmp, 'segredo.txt'), 'não');
  createSkin(TEMPLATE, dir, 'Teste');
  studio = await startStudio({ dir, webDir: web, port: 0, token: 'tok' });
});
afterEach(async () => {
  await studio.close();
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

const url = (p: string) => `http://127.0.0.1:${studio.port}${p}`;
const auth = { 'x-tera-token': 'tok' };

describe('servidor do Studio', () => {
  it('serve o editor e as partes da skin', async () => {
    expect(await (await fetch(url('/'))).text()).toContain('studio');
    const png = await fetch(url('/skin/parts/body.png'));
    expect(png.headers.get('content-type')).toBe('image/png');
  });

  it('a API exige o token', async () => {
    expect((await fetch(url('/api/skin'))).status).toBe(401);
    const r = await fetch(url('/api/skin'), { headers: auth });
    expect(r.status).toBe(200);
    expect((await r.json()).name).toBe('Teste');
  });

  it('não sai da pasta da skin', async () => {
    expect((await fetch(url('/skin/..%2Fsegredo.txt'))).status).toBe(404);
    expect((await fetch(url('/skin/../segredo.txt'))).status).toBe(404);
  });

  it('salva rig válido (com backup) e recusa o que a Tera não carregaria', async () => {
    const rig = JSON.parse(fs.readFileSync(path.join(dir, 'rig.json'), 'utf8'));
    rig.layers[0].z = 21;
    expect((await fetch(url('/api/rig'), { method: 'PUT', headers: auth, body: JSON.stringify(rig) })).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'rig.json'), 'utf8')).layers[0].z).toBe(21);
    expect(fs.existsSync(path.join(dir, 'rig.json.bak'))).toBe(true);
    rig.layers[1].parent = 'nao-existe';
    const bad = await fetch(url('/api/rig'), { method: 'PUT', headers: auth, body: JSON.stringify(rig) });
    expect(bad.status).toBe(422);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'rig.json'), 'utf8')).layers[1].parent).not.toBe('nao-existe');
  });

  it('parte nova: só PNG, só dentro da pasta, sem sobrescrever sem pedir', async () => {
    const png = fs.readFileSync(path.join(dir, 'parts', 'body.png'));
    const post = (file: string, body: BodyInit, extra = '') => fetch(url(`/api/parts?file=${encodeURIComponent(file)}${extra}`), { method: 'POST', headers: auth, body });
    expect((await post('parts/novo.png', png)).status).toBe(200);
    expect(fs.existsSync(path.join(dir, 'parts', 'novo.png'))).toBe(true);
    expect((await post('parts/novo.png', png)).status).toBe(409);
    expect((await post('parts/novo.png', png, '&overwrite=1')).status).toBe(200);
    expect((await post('../fora.png', png)).status).toBe(400);
    expect((await post('parts/texto.png', 'não é png')).status).toBe(400);
  });

  it('recusa outro Host (DNS rebinding) e outra origem', async () => {
    const http = await import('node:http');
    const status = (headers: Record<string, string>) => new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port: studio.port, path: '/api/skin', headers: { ...auth, ...headers } }, (r) => resolve(r.statusCode ?? 0));
    });
    expect(await status({ host: 'evil.com' })).toBe(403);
    expect(await status({ origin: 'http://evil.com' })).toBe(403);
  });
});
