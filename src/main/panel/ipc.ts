// IPC do painel de conversa: validação explícita de tudo que vem do renderer.
// Regras: remetente tem que ser a janela do painel; payload inválido vira erro genérico
// (sem ecoar o conteúdo); o renderer nunca informa caminhos — a pasta vem do seletor do main.
import path from 'node:path';
import { z } from 'zod';
import {
  PANEL_IPC, type FolderPick, type PanelResult, type ProviderDescriptor, type SessionSnapshot,
  type SessionSummary,
} from '../../shared/bridge';
import { BridgeError } from '../bridge/manager';

/** O que o IPC precisa do BridgeManager */
export interface PanelBridge {
  listProviders(): Promise<ProviderDescriptor[]>;
  listSessions(providerId: string, cwd: string): Promise<SessionSummary[]>;
  start(providerId: string, opts: { cwd: string; resumeId?: string }): Promise<string>;
  send(handle: string, text: string): void;
  respondPermission(handle: string, requestId: string, allow: boolean): void;
  interrupt(handle: string): Promise<void>;
  close(handle: string): void;
  snapshot(): SessionSnapshot[];
}

export interface PanelHandlerDeps {
  bridge: PanelBridge;
  /** Abre o seletor de pasta do sistema (consentimento do usuário); null = cancelou */
  pickFolder(providerId: string): Promise<string | null>;
  /** O remetente é a janela do painel? */
  isPanelSender(sender: unknown): boolean;
  hide(): void;
}

const providerId = z.string().min(1).max(64);
const handle = z.string().uuid();

const schemas = {
  pickFolder: z.object({ providerId }).strict(),
  startSession: z.object({ providerId, resumeId: z.string().min(1).max(128).optional() }).strict(),
  send: z.object({ handle, text: z.string().min(1).max(20000) }).strict(),
  respondPermission: z.object({ handle, requestId: z.string().min(1).max(64), allow: z.boolean() }).strict(),
  handleOnly: z.object({ handle }).strict(),
};

const GENERIC_ERROR = 'Requisição inválida.';
const FAILED = 'Não foi possível concluir a operação.';

export type PanelHandler = (sender: unknown, payload: unknown) => Promise<PanelResult<unknown>>;

export function makePanelHandlers(deps: PanelHandlerDeps): Record<string, PanelHandler> {
  /** Pasta escolhida no seletor e as sessões que listamos pra ela (só delas dá pra retomar) */
  let selectedCwd: string | null = null;
  let listedSessions = new Set<string>();

  const run = async (sender: unknown, validate: () => unknown, fn: (input: never) => Promise<unknown> | unknown): Promise<PanelResult<unknown>> => {
    if (!deps.isPanelSender(sender)) return { ok: false, error: GENERIC_ERROR };
    let input: unknown;
    try {
      input = validate();
    } catch {
      return { ok: false, error: GENERIC_ERROR };
    }
    try {
      return { ok: true, data: (await fn(input as never)) ?? null };
    } catch (err) {
      return { ok: false, error: err instanceof BridgeError ? err.message : FAILED };
    }
  };

  const guarded = <T extends z.ZodTypeAny>(schema: T, fn: (input: z.infer<T>) => Promise<unknown> | unknown): PanelHandler =>
    (sender, payload) => run(sender, () => schema.parse(payload), fn);

  const noInput = (fn: () => Promise<unknown> | unknown): PanelHandler =>
    (sender, payload) => run(sender, () => {
      if (payload !== undefined && payload !== null) throw new Error('payload inesperado');
    }, fn);

  return {
    [PANEL_IPC.listProviders]: noInput(() => deps.bridge.listProviders()),

    [PANEL_IPC.pickFolder]: guarded(schemas.pickFolder, async (input): Promise<FolderPick | null> => {
      const dir = await deps.pickFolder(input.providerId);
      if (!dir) return null;
      selectedCwd = dir;
      const sessions = await deps.bridge.listSessions(input.providerId, dir);
      listedSessions = new Set(sessions.map((s) => s.id));
      return { cwdLabel: path.basename(dir) || dir, sessions };
    }),

    [PANEL_IPC.startSession]: guarded(schemas.startSession, async (input) => {
      if (!selectedCwd) throw new BridgeError('Escolha uma pasta primeiro.');
      if (input.resumeId && !listedSessions.has(input.resumeId)) throw new BridgeError('Sessão desconhecida.');
      return { handle: await deps.bridge.start(input.providerId, { cwd: selectedCwd, resumeId: input.resumeId }) };
    }),

    [PANEL_IPC.send]: guarded(schemas.send, (i) => deps.bridge.send(i.handle, i.text)),
    [PANEL_IPC.respondPermission]: guarded(schemas.respondPermission, (i) =>
      deps.bridge.respondPermission(i.handle, i.requestId, i.allow)),
    [PANEL_IPC.interrupt]: guarded(schemas.handleOnly, (i) => deps.bridge.interrupt(i.handle)),
    [PANEL_IPC.closeSession]: guarded(schemas.handleOnly, (i) => deps.bridge.close(i.handle)),
    [PANEL_IPC.snapshot]: noInput(() => deps.bridge.snapshot()),
    [PANEL_IPC.hide]: noInput(() => deps.hide()),
  };
}
