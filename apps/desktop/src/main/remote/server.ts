// Tera no celular, na rede de casa (estilo WhatsApp Web): desligado por padrão. Ligado,
// serve a página do celular e uma API cifrada (shared/remote.ts) na rede local.
//
// Pareamento: a interface mostra um QR com um pareamento descartável (vale 90 s, uma vez).
// O celular lê, manda o nome cifrado com a chave do QR, e o PC pergunta "conectar?".
// Só com o "sim" o celular vira um aparelho conectado (com a chave do QR, que nunca passou
// pela rede). Desconectar nos Ajustes apaga a chave. Nesta fase o celular só acompanha:
// não responde pedidos nem manda comandos.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import QRCode from 'qrcode';
import type { LiveSnapshot, ProviderUsage } from '../../shared/live';
import {
  MAX_AGE_MS, PAIR_TTL_MS, type PairHello, type PairStatus, type RemoteDevice, type RemoteRequest, type RemoteSnapshot,
  type RemoteState, fromB64url, b64url, newId, newKey, open, pairLink, seal,
} from '../../shared/remote';

const MAX_BODY = 16 * 1024;
const MAX_DEVICES = 5;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

export interface StoredDevice extends RemoteDevice {
  /** Chave do aparelho (base64url) */
  key: string;
}

export interface RemoteDeps {
  port: number;
  /** Pasta da página do celular (dist/mobile) */
  webDir: string;
  enabled(): boolean;
  setEnabled(on: boolean): void;
  devices(): StoredDevice[];
  saveDevices(list: StoredDevice[]): void;
  snapshot(): { live: LiveSnapshot; usage: ProviderUsage[] };
  /** Algo mudou (a interface redesenha a parte "Celular") */
  changed(): void;
}

interface Pairing {
  id: string;
  key: Uint8Array;
  expiresAt: number;
  link: string;
  qr: string;
  /** O celular que leu o QR, esperando o "sim" */
  device?: { id: string; name: string };
  status: PairStatus;
}

/** Endereço IPv4 da rede de casa (192.168.x, 10.x, 172.16-31.x); null = nenhum */
export function lanAddress(nets = os.networkInterfaces()): string | null {
  const all = Object.values(nets).flat().filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal);
  const priv = (a: string) => /^192\.168\./.test(a) || /^10\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  return all.find((n) => /^192\.168\./.test(n.address))?.address ?? all.find((n) => priv(n.address))?.address ?? null;
}

/** Aceita só quem está na rede local (ou o próprio PC) */
export function isLocalPeer(ip: string | undefined): boolean {
  const a = (ip ?? '').replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || /^192\.168\./.test(a) || /^10\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^fe80:/i.test(a);
}

const fresh = (at: unknown, now = Date.now()) => typeof at === 'number' && Math.abs(now - at) < MAX_AGE_MS;

export class RemoteServer {
  private server: http.Server | null = null;
  /** Porta em uso (a pedida, ou a que o sistema deu se foi 0) */
  private boundPort = 0;
  private pairing: Pairing | null = null;
  private error: string | undefined;
  /** Nonces já vistos (repetir um pedido gravado não funciona) */
  private readonly seen = new Map<string, number>();

  constructor(private readonly deps: RemoteDeps) {}

  start(): void {
    if (this.deps.enabled()) this.listen();
  }

  /** Porta em uso (0 = desligado) */
  get port(): number {
    return this.server ? this.boundPort : 0;
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.pairing = null;
  }

  state(): RemoteState {
    const p = this.pairing && this.pairing.expiresAt > Date.now() && this.pairing.status === 'waiting' ? this.pairing : null;
    return {
      enabled: this.deps.enabled(),
      address: lanAddress(),
      devices: this.deps.devices().map(({ key: _k, ...d }) => d),
      pairing: p && !p.device ? { qr: p.qr, link: p.link, expiresAt: p.expiresAt } : null,
      pending: p?.device ? { name: p.device.name } : null,
      ...(this.error && { error: this.error }),
    };
  }

  setEnabled(on: boolean): void {
    this.deps.setEnabled(on);
    this.error = undefined;
    if (on) this.listen();
    else this.stop();
    this.deps.changed();
  }

  /** Novo QR code (o anterior deixa de valer) */
  async startPairing(): Promise<void> {
    const host = lanAddress();
    if (!this.server || !host) {
      this.error = host ? 'Ligue o acesso pelo celular primeiro.' : 'Este PC não está numa rede local (Wi-Fi ou cabo).';
      this.deps.changed();
      return;
    }
    if (this.deps.devices().length >= MAX_DEVICES) {
      this.error = `No máximo ${MAX_DEVICES} celulares: desconecte um antes.`;
      this.deps.changed();
      return;
    }
    const id = newId();
    const key = newKey();
    const link = pairLink(host, this.boundPort || this.deps.port, id, key);
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 260, errorCorrectionLevel: 'M' });
    this.pairing = { id, key, link, qr, expiresAt: Date.now() + PAIR_TTL_MS, status: 'waiting' };
    this.error = undefined;
    setTimeout(() => this.deps.changed(), PAIR_TTL_MS + 100);
    this.deps.changed();
  }

  /** O "sim" (ou "não") no PC pro celular que leu o QR */
  confirm(approve: boolean): void {
    const p = this.pairing;
    if (!p?.device || p.status !== 'waiting') return;
    if (approve) {
      const list = this.deps.devices().filter((d) => d.id !== p.device!.id);
      list.push({ id: p.device.id, name: p.device.name, key: b64url(p.key), pairedAt: Date.now() });
      this.deps.saveDevices(list);
      p.status = 'approved';
    } else {
      p.status = 'denied';
    }
    this.deps.changed();
  }

  revoke(id: string): void {
    this.deps.saveDevices(this.deps.devices().filter((d) => d.id !== id));
    this.deps.changed();
  }

  // ---------- rede ----------

  private listen(): void {
    if (this.server) return;
    const server = http.createServer((req, res) => void this.handle(req, res));
    server.on('error', (err: NodeJS.ErrnoException) => {
      this.error = err.code === 'EADDRINUSE' ? `A porta ${this.deps.port} já está em uso.` : `Não consegui abrir o acesso: ${err.message}`;
      this.server = null;
      this.deps.changed();
    });
    // a rede toda, mas o handle recusa quem não é da rede local
    server.listen(this.deps.port, '0.0.0.0', () => { this.boundPort = (server.address() as { port: number }).port; });
    this.server = server;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!isLocalPeer(req.socket.remoteAddress)) return void res.writeHead(403).end();
    const url = (req.url ?? '/').split('?')[0]!;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (req.method === 'GET') {
      const file = url === '/' ? 'index.html' : url.slice(1);
      if (!/^[\w.-]+$/.test(file)) return void res.writeHead(404).end();
      const full = path.join(this.deps.webDir, file);
      if (!fs.existsSync(full)) return void res.writeHead(404).end();
      res.writeHead(200, {
        ...headers,
        'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
      });
      return void fs.createReadStream(full).pipe(res);
    }
    if (req.method !== 'POST') return void res.writeHead(405).end();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      return void res.writeHead(400).end();
    }
    const reply = (status: number, data?: unknown): void => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }).end(data === undefined ? '' : JSON.stringify(data));
    };
    if (url === '/pair') return reply(...this.onPair(body));
    if (url === '/api') return reply(...this.onApi(body));
    reply(404);
  }

  /** Pareamento: o celular manda o nome (cifrado com a chave do QR) e depois pergunta se foi aceito */
  private onPair(body: Record<string, unknown>): [number, unknown?] {
    const p = this.pairing;
    if (!p || body.pair !== p.id) return [404];
    if (p.expiresAt < Date.now() && p.status === 'waiting') p.status = 'expired';
    const hello = open<PairHello>(p.key, body.box);
    if (!hello || !fresh(hello.at) || !this.firstTime(body.box)) return [401];
    const device = typeof body.device === 'string' && /^[\w-]{8,40}$/.test(body.device) ? body.device : null;
    if (!device) return [400];
    if (!p.device && p.status === 'waiting') {
      // o primeiro celular que leu o QR fica com ele; o PC pergunta
      p.device = { id: device, name: (typeof hello.name === 'string' ? hello.name : '').slice(0, 40) || 'Celular' };
      this.deps.changed();
    }
    const status: PairStatus = p.device?.id === device ? p.status : 'denied';
    return [200, seal(p.key, { status, at: Date.now() })];
  }

  private onApi(body: Record<string, unknown>): [number, unknown?] {
    const dev = this.deps.devices().find((d) => d.id === body.device);
    const key = dev ? fromB64url(dev.key) : null;
    if (!dev || !key) return [401];
    const req = open<RemoteRequest>(key, body.box);
    if (!req || !fresh(req.at) || !this.firstTime(body.box)) return [401];
    if (req.op !== 'snapshot') return [400];
    const now = Date.now();
    if (!dev.lastSeen || now - dev.lastSeen > 60_000) {
      this.deps.saveDevices(this.deps.devices().map((d) => (d.id === dev.id ? { ...d, lastSeen: now } : d)));
    }
    const snap: RemoteSnapshot = { pcName: os.hostname(), ...this.deps.snapshot(), at: now };
    return [200, seal(key, snap)];
  }

  private firstTime(box: unknown): boolean {
    const n = (box as { n?: unknown } | null)?.n;
    if (typeof n !== 'string') return false;
    const now = Date.now();
    for (const [k, t] of this.seen) if (now - t > MAX_AGE_MS * 2) this.seen.delete(k);
    if (this.seen.has(n)) return false;
    this.seen.set(n, now);
    return true;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('grande demais'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
