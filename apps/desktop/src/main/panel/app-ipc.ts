// IPC da parte "app" da interface (conectar agentes). Mesmas regras do IPC do painel:
// só a janela da interface pode chamar, entrada validada, erro genérico sem ecoar nada.
import { z } from 'zod';
import type { PanelResult } from '@tera/agent-bridge/contract';
import { APP_PANEL_IPC, type AgentConnection } from '../../shared/app-panel';

export interface AppPanelDeps {
  isPanelSender(sender: unknown): boolean;
  connections(): Promise<AgentConnection[]>;
  /** false = id desconhecido */
  connect(id: string): Promise<boolean>;
  setSpeech(id: string, on: boolean): Promise<boolean>;
  copyOpenSessions(id: string): boolean;
}

const id = z.string().min(1).max(64);
const schemas = {
  connections: z.null().optional(),
  connect: z.object({ id }).strict(),
  setSpeech: z.object({ id, on: z.boolean() }).strict(),
  copyOpenSessions: z.object({ id }).strict(),
};

const INVALID = 'Requisição inválida.';
const UNKNOWN = 'Agente desconhecido.';

export type AppPanelHandler = (sender: unknown, payload: unknown) => Promise<PanelResult<unknown>>;

export function makeAppPanelHandlers(deps: AppPanelDeps): Record<string, AppPanelHandler> {
  const guarded = <T extends z.ZodTypeAny>(schema: T, fn: (input: z.infer<T>) => Promise<PanelResult<unknown>>): AppPanelHandler =>
    async (sender, payload) => {
      if (!deps.isPanelSender(sender)) return { ok: false, error: INVALID };
      const parsed = schema.safeParse(payload);
      if (!parsed.success) return { ok: false, error: INVALID };
      try {
        return await fn(parsed.data);
      } catch {
        return { ok: false, error: 'Não foi possível concluir a operação.' };
      }
    };
  const list = async (): Promise<PanelResult<unknown>> => ({ ok: true, data: await deps.connections() });

  return {
    [APP_PANEL_IPC.connections]: guarded(schemas.connections, list),
    [APP_PANEL_IPC.connect]: guarded(schemas.connect, async ({ id }) => ((await deps.connect(id)) ? list() : { ok: false, error: UNKNOWN })),
    [APP_PANEL_IPC.setSpeech]: guarded(schemas.setSpeech, async ({ id, on }) => ((await deps.setSpeech(id, on)) ? list() : { ok: false, error: UNKNOWN })),
    [APP_PANEL_IPC.copyOpenSessions]: guarded(schemas.copyOpenSessions, async ({ id }) =>
      (deps.copyOpenSessions(id) ? { ok: true, data: null } : { ok: false, error: UNKNOWN })),
  };
}
