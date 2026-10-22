// Serviço de aprovações: HMAC com chave só em memória (gerada a cada boot, nunca persistida), uso único,
// TTL e fencing (contrato §4). Só o caminho de comando da UI chama `decideByUser`; runner e agente não.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ActionClass } from '../../../shared/pocket';
import { ApprovalError, type ApprovalRow, type PocketStore } from '../core/store';
import type { SignedDecision } from '../runner/types';

export const APPROVAL_TTL_MS = 10 * 60_000; // decisão 4

export interface ApprovalRequestInput {
  runId: string;
  toolUseId?: string;
  toolName: string;
  actionKey: string;
  classification: ActionClass;
  summary: string;
}

export class ApprovalService {
  private readonly key: Buffer;

  constructor(private readonly store: PocketStore, private readonly opts: { ttlMs?: number; now?: () => number; key?: Buffer } = {}) {
    // chave só em memória: reiniciar o core invalida toda decisão assinada antes (contrato §4)
    this.key = opts.key ?? randomBytes(32);
  }

  private now(): number { return (this.opts.now ?? this.store.now)(); }

  private mac(a: Pick<ApprovalRow, 'approvalRequestId' | 'runId' | 'taskId' | 'toolName' | 'actionKey' | 'toolUseId' | 'expiresAt'>, decision: string): string {
    const msg = [a.approvalRequestId, a.runId, a.taskId, a.toolName, a.actionKey, a.toolUseId ?? '', decision, a.expiresAt, this.store.fence].join('|');
    return createHmac('sha256', this.key).update(msg).digest('hex');
  }

  request(i: ApprovalRequestInput): ApprovalRow {
    const expiresAt = this.now() + (this.opts.ttlMs ?? APPROVAL_TTL_MS);
    return this.store.createApprovalRequest({
      approvalRequestId: `areq_${randomUUID()}`, taskId: '', sessionId: '', runId: i.runId, toolUseId: i.toolUseId ?? null,
      toolName: i.toolName, actionKey: i.actionKey, classification: i.classification, summary: i.summary, expiresAt,
    });
  }

  /**
   * Decisão do usuário (clique na UI). Um gesto: grava a decisão assinada e devolve a tarefa a `running`.
   * Retorna a decisão para repassar ao runner (`resolveApproval`).
   */
  decideByUser(approvalRequestId: string, decision: 'allow' | 'deny', gestureId: string): SignedDecision {
    const a = this.store.mustApproval(approvalRequestId);
    const hmac = this.mac(a, decision);
    this.store.decideApproval(approvalRequestId, { decision, actor: 'user', gestureId, hmac, resumeTask: true });
    return { approvalRequestId, decision, hmac };
  }

  /** Negação do sistema (expiração, interrupção): nunca `allow`. */
  denyBySystem(approvalRequestId: string): void {
    const a = this.store.getApproval(approvalRequestId);
    if (!a || a.decision !== null) return;
    this.store.decideApproval(approvalRequestId, { decision: 'deny', actor: 'system', hmac: this.mac(a, 'deny') });
  }

  /**
   * Verifica a decisão no ponto de uso (antes de responder `allow` ao Claude): HMAC desta instância,
   * mesmo run, decisão idêntica à gravada, fence vigente. Não consome — quem consome é `consume`.
   */
  verify(runId: string, s: SignedDecision): ApprovalRow {
    const a = this.store.getApproval(s.approvalRequestId);
    if (!a) throw new ApprovalError('unknown');
    if (a.runId !== runId) throw new ApprovalError('run_mismatch');
    if (a.decision !== s.decision || a.hmac === null) throw new ApprovalError('bad_hmac', 'decisão divergente da gravada');
    const expected = Buffer.from(this.mac(a, a.decision), 'hex');
    const given = Buffer.from(s.hmac, 'hex');
    const stored = Buffer.from(a.hmac, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given) || stored.length !== expected.length || !timingSafeEqual(expected, stored)) {
      throw new ApprovalError('bad_hmac');
    }
    return a;
  }

  /** Consumo único + TTL + run vivo + fence da decisão (tudo dentro de uma transação no store). */
  consume(approvalRequestId: string): ApprovalRow {
    return this.store.consumeApproval(approvalRequestId);
  }
}
