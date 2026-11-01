import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RemoteSnapshot, newId, newKey, open, parsePairFragment, pairLink, seal } from '../../shared/remote';
import { RemoteServer, type StoredDevice, isLocalPeer, lanAddress } from './server';

vi.mock('node:os', async (orig) => {
  const real = await orig<typeof import('node:os')>();
  return { ...real, default: { ...real, networkInterfaces: () => ({ wlan0: [{ family: 'IPv4', internal: false, address: '192.168.0.50' }] }) } };
});

let server: RemoteServer | null = null;
afterEach(() => server?.stop());

function make() {
  const web = fs.mkdtempSync(path.join(os.tmpdir(), 'tera-remote-'));
  fs.writeFileSync(path.join(web, 'index.html'), '<h1>tera</h1>');
  let enabled = true;
  let devices: StoredDevice[] = [];
  const changed = vi.fn();
  server = new RemoteServer({
    port: 0, webDir: web,
    enabled: () => enabled, setEnabled: (on) => { enabled = on; },
    devices: () => devices, saveDevices: (d) => { devices = d; },
    snapshot: () => ({ live: { active: [], ended: [] }, usage: [] }),
    changed,
  });
  server.start();
  return { server, devices: () => devices, changed };
}

const ready = async (s: RemoteServer) => { for (let i = 0; i < 50 && !s.port; i++) await new Promise((r) => setTimeout(r, 10)); };
const post = async (s: RemoteServer, p: string, body: unknown) => {
  const r = await fetch(`http://127.0.0.1:${s.port}${p}`, { method: 'POST', body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, data: text ? JSON.parse(text) : null };
};

describe('criptografia do celular', () => {
  it('fecha e abre; chave errada ou mensagem mexida não abre', () => {
    const k = newKey();
    const box = seal(k, { a: 1 });
    expect(open(k, box)).toEqual({ a: 1 });
    expect(open(newKey(), box)).toBeNull();
    expect(open(k, { ...box, c: box.c.slice(0, -2) + (box.c.endsWith('A') ? 'B' : 'A') })).toBeNull();
  });

  it('o link do QR leva a chave depois do # (que não sai do celular)', () => {
    const k = newKey();
    const link = pairLink('192.168.0.5', 7778, 'abcdefgh1234', k);
    const frag = parsePairFragment(link.slice(link.indexOf('#')));
    expect(frag?.pairId).toBe('abcdefgh1234');
    expect(frag?.key).toEqual(k);
    expect(parsePairFragment('#p=x.y')).toBeNull();
  });

  it('só gente da rede local', () => {
    expect(isLocalPeer('192.168.1.20')).toBe(true);
    expect(isLocalPeer('::ffff:10.0.0.3')).toBe(true);
    expect(isLocalPeer('8.8.8.8')).toBe(false);
    expect(lanAddress({ eth0: [{ family: 'IPv4', internal: false, address: '192.168.0.9' } as os.NetworkInterfaceInfo] })).toBe('192.168.0.9');
  });
});

describe('pareamento e leitura', () => {
  it('QR → PC confirma → celular lê cifrado; desconectar corta', async () => {
    const { server: s, devices } = make();
    await ready(s);
    await s.startPairing();
    const link = s.state().pairing!.link;
    const { pairId, key } = parsePairFragment(link.slice(link.indexOf('#')))!;
    const device = newId();

    let r = await post(s, '/pair', { pair: pairId, device, box: seal(key, { name: 'Pixel', at: Date.now() }) });
    expect(open(key, r.data)).toMatchObject({ status: 'waiting' });
    expect(s.state().pending).toEqual({ name: 'Pixel' });

    // outro celular com o mesmo QR (alguém fotografou): não entra
    r = await post(s, '/pair', { pair: pairId, device: newId(), box: seal(key, { name: 'Intruso', at: Date.now() }) });
    expect(open(key, r.data)).toMatchObject({ status: 'denied' });

    s.confirm(true);
    r = await post(s, '/pair', { pair: pairId, device, box: seal(key, { name: 'Pixel', at: Date.now() }) });
    expect(open(key, r.data)).toMatchObject({ status: 'approved' });
    expect(devices()).toHaveLength(1);

    const req = seal(key, { op: 'snapshot', at: Date.now() });
    r = await post(s, '/api', { device, box: req });
    expect(r.status).toBe(200);
    expect(open<RemoteSnapshot>(key, r.data)?.live).toEqual({ active: [], ended: [] });
    // o mesmo pedido de novo (gravado da rede): recusado
    expect((await post(s, '/api', { device, box: req })).status).toBe(401);
    // chave errada
    expect((await post(s, '/api', { device, box: seal(newKey(), { op: 'snapshot', at: Date.now() }) })).status).toBe(401);
    // pedido velho
    expect((await post(s, '/api', { device, box: seal(key, { op: 'snapshot', at: Date.now() - 120_000 }) })).status).toBe(401);

    s.revoke(device);
    expect((await post(s, '/api', { device, box: seal(key, { op: 'snapshot', at: Date.now() }) })).status).toBe(401);
  });

  it('PC recusou: o celular fica de fora', async () => {
    const { server: s, devices } = make();
    await ready(s);
    await s.startPairing();
    const link = s.state().pairing!.link;
    const { pairId, key } = parsePairFragment(link.slice(link.indexOf('#')))!;
    const device = newId();
    await post(s, '/pair', { pair: pairId, device, box: seal(key, { name: 'X', at: Date.now() }) });
    s.confirm(false);
    const r = await post(s, '/pair', { pair: pairId, device, box: seal(key, { name: 'X', at: Date.now() }) });
    expect(open(key, r.data)).toMatchObject({ status: 'denied' });
    expect(devices()).toHaveLength(0);
  });

  it('serve a página e nada fora dela', async () => {
    const { server: s } = make();
    await ready(s);
    expect(await (await fetch(`http://127.0.0.1:${s.port}/`)).text()).toContain('tera');
    expect((await fetch(`http://127.0.0.1:${s.port}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });
});
