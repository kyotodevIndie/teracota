// Contrato entre o BridgeManager e os providers de agente.
import type { ProviderDescriptor, ProviderEventBody, SessionSummary } from '../../shared/bridge';

export type ProviderSink = (event: ProviderEventBody) => void;

export interface ProviderSession {
  /** Envia o texto do usuário como novo turno */
  send(text: string): void | Promise<void>;
  /** Responde a um pedido de permissão pendente (só uma vez; ids desconhecidos são ignorados) */
  respondPermission(id: string, allow: boolean): void;
  /** Interrompe o turno em andamento; resolve quando o agente parou */
  interrupt(): Promise<void>;
  close(): void;
}

export interface AgentProvider {
  readonly id: string;
  readonly displayName: string;
  /** Provider de simulação (dev): sem agente real */
  readonly simulated?: boolean;
  checkAvailability(): Promise<Pick<ProviderDescriptor, 'available' | 'reason'>>;
  listSessions(cwd: string): Promise<SessionSummary[]>;
  start(opts: { cwd: string; resumeId?: string }, sink: ProviderSink): Promise<ProviderSession>;
}
