// IPC da parte "app" da interface (conectar agentes). Mesmas regras do IPC do painel:
// só a janela da interface pode chamar, entrada validada, erro genérico sem ecoar nada.
import { z } from 'zod';
import type { PanelResult } from '@tera/agent-bridge/contract';
import { APP_PANEL_IPC, type AgentConnection, type TerminalSnapshot } from '../../shared/app-panel';

export interface AppPanelDeps {
  isPanelSender(sender: unknown): boolean;
  connections(): Promise<AgentConnection[]>;
  /** false = id desconhecido */
  connect(id: string): Promise<boolean>;
  setSpeech(id: string, on: boolean): Promise<boolean>;
  copyOpenSessions(id: string): boolean;
  terminal: {
    /** Seletor do sistema (o consentimento); devolve o nome da pasta ou null */
    pickFolder(): Promise<string | null>;
    start(cols: number, rows: number, claude: boolean): TerminalSnapshot;
    snapshot(): TerminalSnapshot;
    kill(): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
  };
}

const id = z.string().min(1).max(64);
const schemas = {
  connections: z.null().optional(),
  connect: z.object({ id }).strict(),
  setSpeech: z.object({ id, on: z.boolean() }).strict(),
  copyOpenSessions: z.object({ id }).strict(),
  terminalStart: z.object({ cols: z.number().int().min(2).max(1000), rows: z.number().int().min(2).max(1000), claude: z.boolean() }).strict(),
  terminalInput: z.string().min(1).max(64 * 1024),
  terminalResize: z.object({ cols: z.number().int().min(2).max(1000), rows: z.number().int().min(2).max(1000) }).strict(),
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
    [APP_PANEL_IPC.terminalPickFolder]: guarded(schemas.connections, async () => ({ ok: true, data: await deps.terminal.pickFolder() })),
    [APP_PANEL_IPC.terminalStart]: guarded(schemas.terminalStart, async ({ cols, rows, claude }) => ({ ok: true, data: deps.terminal.start(cols, rows, claude) })),
    [APP_PANEL_IPC.terminalSnapshot]: guarded(schemas.connections, async () => ({ ok: true, data: deps.terminal.snapshot() })),
    [APP_PANEL_IPC.terminalKill]: guarded(schemas.connections, async () => {
      deps.terminal.kill();
      return { ok: true, data: null };
    }),
  };
}

export type AppPanelListener = (sender: unknown, payload: unknown) => void;

/** Entrada e tamanho do terminal: mensagens sem resposta (muitas por segundo), mesma validação */
export function makeTerminalListeners(deps: Pick<AppPanelDeps, 'isPanelSender' | 'terminal'>): Record<string, AppPanelListener> {
  return {
    [APP_PANEL_IPC.terminalInput]: (sender, payload) => {
      const parsed = schemas.terminalInput.safeParse(payload);
      if (deps.isPanelSender(sender) && parsed.success) deps.terminal.write(parsed.data);
    },
    [APP_PANEL_IPC.terminalResize]: (sender, payload) => {
      const parsed = schemas.terminalResize.safeParse(payload);
      if (deps.isPanelSender(sender) && parsed.success) deps.terminal.resize(parsed.data.cols, parsed.data.rows);
    },
  };
}
