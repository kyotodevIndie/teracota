// Implementação dos ganchos de permissão do adapter: classifica, aplica R6, pede aprovação, confere
// fencing antes de TODO allow e registra a intenção no ledger antes de devolver (contrato §3 e §4).
import type { PocketStore } from '../core/store';
import type { PermissionHooks, RunContext, SignedDecision, ToolDecision, ToolRequest } from '../runner/types';
import type { ApprovalService } from './approvals';
import { actionKeyOf, classifyTool, type Classification } from './policy';
import { workspaceRealpath } from './paths';

export interface HooksDeps {
  store: PocketStore;
  approvals: ApprovalService;
  /** O lock de execução (sessão + slot) ainda é nosso? */
  lockHeld: (ctx: RunContext) => boolean;
}

const LOST: ToolDecision = { kind: 'deny', message: 'o Teracota perdeu a exclusividade desta execução; ação negada', interrupt: true, code: 'LOCK_LOST' };

export function createPermissionHooks(d: HooksDeps): PermissionHooks {
  const { store, approvals } = d;

  const fenceOk = (ctx: RunContext): boolean => store.fenceIsCurrent() && d.lockHeld(ctx);

  function recordIntent(ctx: RunContext, req: ToolRequest, cls: Classification, actionKey: string): void {
    if (!cls.writes) return;
    store.recordIntent({
      taskId: ctx.taskId, sessionId: ctx.sessionId, runId: ctx.runId, toolUseId: req.toolUseId ?? null, toolName: req.toolName,
      actionKey, classification: cls.cls, summary: cls.summary, targetPath: cls.targetPath ?? null,
      expectedHash: cls.expectedHash ?? null, verifiable: cls.verifiable,
    });
  }

  function classify(ctx: RunContext, req: ToolRequest): Classification {
    let ws: string;
    try { ws = workspaceRealpath(ctx.cwd); } catch {
      return { cls: 'unknown', auto: false, verifiable: false, writes: true, summary: req.toolName, reason: 'workspace não resolvível' };
    }
    return classifyTool(req.toolName, req.input, ws, ctx.cwd);
  }

  function precheck(ctx: RunContext, req: ToolRequest): ToolDecision | 'ask' | null {
    if (!fenceOk(ctx)) return LOST;
    const cls = classify(ctx, req);
    if (cls.deny) return { kind: 'deny', message: cls.deny, code: 'POLICY_DENIED' };
    const blocked = store.blockedActionKeys(ctx.taskId).get(actionKeyOf(ctx.taskId, req.toolName, req.input));
    if (blocked === 'deny') {
      return { kind: 'deny', message: 'esta ação pode já ter sido executada antes da falha; resolva-a no painel de reconciliação', code: 'POLICY_DENIED' };
    }
    // o canUseTool precisa ver tudo que escreve ou que a política não libera sozinha (intenção no ledger, aprovação)
    if (!cls.auto || cls.writes || blocked === 'reapprove') return 'ask';
    return null;
  }

  return {
    precheck,
    async decide(ctx, req): Promise<ToolDecision> {
      if (!fenceOk(ctx)) return LOST;
      const cls = classify(ctx, req);
      if (cls.deny) return { kind: 'deny', message: cls.deny, code: 'POLICY_DENIED' };
      const actionKey = actionKeyOf(ctx.taskId, req.toolName, req.input);

      // R6: efeito de uma execução anterior possivelmente já aplicado
      const blocked = store.blockedActionKeys(ctx.taskId).get(actionKey);
      if (blocked === 'deny') {
        return { kind: 'deny', message: 'esta ação pode já ter sido executada antes da falha; resolva-a no painel de reconciliação', code: 'POLICY_DENIED' };
      }
      if (cls.auto && blocked === undefined) {
        if (!fenceOk(ctx)) return LOST; // fencing imediatamente antes do efeito
        recordIntent(ctx, req, cls, actionKey);
        return { kind: 'allow' };
      }
      const row = approvals.request({
        runId: ctx.runId, toolUseId: req.toolUseId, toolName: req.toolName, actionKey,
        classification: blocked === 'reapprove' ? 'destructive' : cls.cls,
        summary: blocked === 'reapprove' ? `REPETIÇÃO de ação já marcada como aplicada: ${cls.summary}` : `${cls.summary} — ${cls.reason}`,
      });
      return {
        kind: 'ask', approvalRequestId: row.approvalRequestId, actionKey, classification: row.classification as Classification['cls'],
        summary: row.summaryShown, expiresAt: row.expiresAt,
      };
    },

    async finalize(ctx: RunContext, req: ToolRequest, s: SignedDecision): Promise<ToolDecision> {
      try {
        const a = approvals.verify(ctx.runId, s);
        if (s.decision === 'deny') return { kind: 'deny', message: 'negado pelo usuário' };
        if (!fenceOk(ctx)) return LOST;
        // a ferramenta que o Claude quer rodar tem de ser a que o usuário viu
        const cls = classify(ctx, req);
        if (cls.deny) return { kind: 'deny', message: cls.deny, code: 'POLICY_DENIED' };
        const key = actionKeyOf(ctx.taskId, req.toolName, req.input);
        if (key !== a.actionKey || req.toolName !== a.toolName || (a.toolUseId !== null && req.toolUseId !== a.toolUseId)) return { kind: 'deny', message: 'a ação mudou depois da aprovação; ação negada' };
        approvals.consume(s.approvalRequestId); // uso único + TTL + run vivo + fence da decisão
        if (!fenceOk(ctx)) return LOST;
        recordIntent(ctx, req, cls, key);
        return { kind: 'allow' };
      } catch (e) {
        return { kind: 'deny', message: `aprovação inválida: ${(e as Error).message}` };
      }
    },

    toolResult(ctx: RunContext, toolUseId: string): void {
      store.confirmEffect(ctx.runId, toolUseId);
    },
  };
}
