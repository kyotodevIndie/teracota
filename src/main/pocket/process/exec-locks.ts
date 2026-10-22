// Exclusividade de execução: lock do slot global (MVP: uma tarefa ativa) + lock da sessão.
// Ambos são objetos do kernel; sumir com o processo os libera (sem lock obsoleto).
import { lockName, OsLock } from './os-lock';

export interface ExecLease {
  readonly held: boolean;
  release(): Promise<void>;
}
export interface ExecLocks {
  /** Falha com LockBusyError se o slot ou a sessão já tiverem dono. */
  acquire(sessionId: string): Promise<ExecLease>;
}

export class OsExecLocks implements ExecLocks {
  /** `namespace`: diretório de dados — separa instalações/testes. */
  constructor(private readonly namespace: string, private readonly label = 'teracota-pocket') {}

  async acquire(sessionId: string): Promise<ExecLease> {
    const slot = await OsLock.acquire(lockName('slot', this.namespace), `${this.label}:slot`);
    let session: OsLock;
    try {
      session = await OsLock.acquire(lockName('session', sessionId), `${this.label}:session`);
    } catch (e) {
      await slot.release();
      throw e;
    }
    return {
      get held() { return slot.held && session.held; },
      release: async () => { try { await session.release(); } finally { await slot.release(); } },
    };
  }
}
