// Lock nativo do SO sem addon: um objeto do kernel que só pode ter um dono e some quando o dono morre.
//  - Windows: named pipe (`\\.\pipe\...`). O kernel recusa o 2º `listen` (EADDRINUSE) e libera o nome
//    no instante em que o processo termina (kill -9 incluído). Não há arquivo, PID, heartbeat nem
//    tempo de criação a comparar: eliminam-se as lacunas 1, 4, 5 e 6 do contrato §6.
//  - POSIX: socket de domínio Unix; um socket remanescente de crash é detectado (connect → ECONNREFUSED).
// O dono responde a quem se conecta com sua identidade (só para diagnóstico/UI, nunca como prova de posse).
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface LockOwnerInfo {
  pid: number;
  since: number;
  label: string;
}

export class LockBusyError extends Error {
  readonly code = 'LOCK_BUSY' as const;
  constructor(readonly lockName: string, readonly owner: LockOwnerInfo | null) {
    super(`lock ocupado: ${lockName}${owner ? ` (pid ${owner.pid}, ${owner.label})` : ''}`);
    this.name = 'LockBusyError';
  }
}

/** O namespace de pipes é global entre sessões do Windows: o usuário entra na chave. */
export function lockName(kind: 'core' | 'slot' | 'session', key: string): string {
  const norm = process.platform === 'win32' ? key.toLowerCase() : key;
  const user = os.userInfo().username.toLowerCase();
  return `teracota-pocket-${kind}-${createHash('sha256').update(`${user}\n${norm}`).digest('hex').slice(0, 24)}`;
}

/** Chave do lock do core: identidade do arquivo (junction, 8.3 e caminho estendido resolvem para o mesmo). */
export function coreLockKey(dbPath: string): string {
  try { return realpathSync.native(dbPath); } catch { return path.resolve(dbPath); }
}

export class UnsupportedPlatformError extends Error {
  constructor() {
    super('Tera Pocket Fase 1: lock e processos só são suportados no Windows (POSIX bloqueado: corrida no unlink do socket)');
    this.name = 'UnsupportedPlatformError';
  }
}

function endpoint(name: string, dir?: string): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\${name}`;
  const d = dir ?? path.join(os.tmpdir(), `teracota-locks-${os.userInfo().username}`);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return path.join(d, `${name}.sock`);
}

function probeOwner(ep: string): Promise<{ alive: boolean; owner: LockOwnerInfo | null }> {
  return new Promise((resolve) => {
    const sock = net.connect(ep);
    let buf = '';
    const done = (alive: boolean) => {
      clearTimeout(timer);
      sock.destroy();
      let owner: LockOwnerInfo | null = null;
      try { owner = JSON.parse(buf.trim()) as LockOwnerInfo; } catch { /* dono não respondeu */ }
      resolve({ alive, owner });
    };
    const timer = setTimeout(() => done(true), 1000);
    sock.on('data', (d) => { buf += d.toString(); });
    sock.on('end', () => done(true));
    sock.on('error', (e: NodeJS.ErrnoException) => {
      // POSIX: ECONNREFUSED/ENOENT = socket órfão; Windows: pipe sumiu entre o listen e o connect
      clearTimeout(timer);
      sock.destroy();
      resolve({ alive: e.code !== 'ECONNREFUSED' && e.code !== 'ENOENT', owner: null });
    });
  });
}

export class OsLock {
  private server: net.Server | null;
  readonly info: LockOwnerInfo;

  private constructor(readonly name: string, server: net.Server, info: LockOwnerInfo) {
    this.server = server;
    this.info = info;
  }

  get held(): boolean {
    return this.server?.listening === true;
  }

  static async acquire(name: string, label: string, opts: { dir?: string } = {}): Promise<OsLock> {
    if (process.platform !== 'win32') throw new UnsupportedPlatformError();
    const ep = endpoint(name, opts.dir);
    const info: LockOwnerInfo = { pid: process.pid, since: Date.now(), label };
    for (let attempt = 0; attempt < 2; attempt++) {
      const server = net.createServer((sock) => {
        sock.on('error', () => undefined);
        sock.end(`${JSON.stringify(info)}\n`);
      });
      const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
        server.once('error', (e: NodeJS.ErrnoException) => resolve(e));
        server.listen(ep, () => resolve(null));
      });
      if (!err) {
        server.on('error', () => undefined); // erros posteriores ao listen não podem derrubar o main
        server.unref();
        return new OsLock(name, server, info);
      }
      server.close();
      if (err.code !== 'EADDRINUSE') throw err;
      const probe = await probeOwner(ep);
      if (probe.alive || process.platform === 'win32') throw new LockBusyError(name, probe.owner);
      // POSIX: socket sem dono (crash). Remove e tenta uma vez mais.
      try { unlinkSync(ep); } catch { /* corrida com outro processo: o listen seguinte decide */ }
    }
    throw new LockBusyError(name, null);
  }

  async release(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (!s) return;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}
