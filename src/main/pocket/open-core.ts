// Única porta de produção para abrir o Core. Ordem obrigatória (revisão Opus, etapas A e B):
//   lock nativo do core → abertura/migração/fence → varredura de órfãos → (reconciliação, scheduler).
// Quem abre o banco sem passar por aqui (testes) assume a responsabilidade pela exclusividade.
import { PocketStore } from './core/store';
import { type Containment, TaskkillContainment } from './process/containment';
import { coreLockKey, lockName, OsLock } from './process/os-lock';
import { type OrphanReport, type ProcInfoApi, sweepOrphans } from './process/supervisor';

export interface OpenedCore {
  store: PocketStore;
  lock: OsLock;
  containment: Containment;
  orphans: OrphanReport;
  close(): Promise<void>;
}

export async function openCore(dbPath: string, opts: { label?: string; containment?: Containment; info?: ProcInfoApi } = {}): Promise<OpenedCore> {
  const containment = opts.containment ?? new TaskkillContainment();
  // o arquivo pode ainda não existir: a chave usa o caminho resolvido (e o real, quando existir)
  const lock = await OsLock.acquire(lockName('core', coreLockKey(dbPath)), opts.label ?? 'teracota-pocket');
  let store: PocketStore | null = null;
  try {
    store = PocketStore.open(dbPath);
    const orphans = await sweepOrphans(store, containment, lock, opts.info);
    const s = store;
    return {
      store: s, lock, containment, orphans,
      close: async () => { try { s.close(); containment.dispose(); } finally { await lock.release(); } },
    };
  } catch (e) {
    store?.close();
    await lock.release();
    throw e;
  }
}
