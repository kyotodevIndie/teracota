// Contenção da árvore de processos do runner.
//  - JobObjectContainment (job-object.ts, koffi): produção. KILL_ON_JOB_CLOSE; falha de criação/associação é fatal.
//  - TaskkillContainment (sem dependência): só para testes/ambientes sem Job Object. Encerra a árvore à força, mas NÃO
//    cobre a queda do host além do que o libuv já faz para o filho direto; o resto é limpo no próximo boot
//    (sweepOrphans em supervisor.ts, por pid + tempo de criação). Nunca é um modo de produção.
import { execFile } from 'node:child_process';

export interface AdoptResult {
  /** O processo foi associado a um mecanismo que o encerra com o host (Job Object)? */
  assigned: boolean;
  /** Garantia estrita de isolamento? Sempre false: ver limites em job-object.ts. */
  guaranteed: boolean;
  note?: string;
}

export interface Containment {
  readonly kind: 'taskkill' | 'job-object';
  /** true = sem associação bem-sucedida o processo NÃO pode receber entrada (falha segura). */
  readonly required: boolean;
  /** Chamado logo após o spawn; o stdin do runner só abre se `assigned` (quando `required`). */
  adopt(pid: number): Promise<AdoptResult>;
  /** O runner terminou: encerra o que sobrou da sua árvore (processos em segundo plano). */
  release(pid: number): void;
  /** Encerramento forçado da árvore inteira. */
  killTree(pid: number): Promise<void>;
  /** Mata UM pid (sem /T): usado quando a árvore foi montada com verificação de tempo de criação. */
  killPid(pid: number): Promise<void>;
  dispose(): void;
}

export class TaskkillContainment implements Containment {
  readonly kind = 'taskkill' as const;
  readonly required = false;

  async adopt(): Promise<AdoptResult> {
    return { assigned: false, guaranteed: false, note: 'sem Job Object: só o filho direto morre com o host (libuv)' };
  }

  release(): void { /* nada: a limpeza de descendentes é do supervisor */ }

  killTree(pid: number): Promise<void> {
    if (process.platform === 'win32') {
      return new Promise((resolve) => {
        // 128 = processo inexistente (já morreu): não é erro para nós
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
      });
    }
    try { process.kill(-pid, 'SIGKILL'); } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* já morreu */ }
    }
    return Promise.resolve();
  }

  killPid(pid: number): Promise<void> {
    if (process.platform === 'win32') {
      return new Promise((resolve) => { execFile('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true }, () => resolve()); });
    }
    try { process.kill(pid, 'SIGKILL'); } catch { /* já morreu */ }
    return Promise.resolve();
  }

  dispose(): void { /* nada a liberar */ }
}
