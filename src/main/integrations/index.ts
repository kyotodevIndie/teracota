// Registro das integrações com agentes. Pra adicionar uma: crie a pasta do adapter,
// implemente AgentAdapter e inclua aqui (veja docs/INTEGRACOES.md).
import type { AgentProvider } from '../bridge/types';
import { claudeCode } from './claude-code/adapter';
import { createClaudeCodeProvider } from './claude-code/bridge-provider';
import type { AgentAdapter, AgentCapabilities } from './types';

export const ADAPTERS: readonly AgentAdapter[] = [claudeCode];

/** Agentes que o painel de conversa (experimental) sabe dirigir */
export const BRIDGE_PROVIDERS: readonly AgentProvider[] = [createClaudeCodeProvider()];

/**
 * Integrações da comunidade via API local (`/api/v1/event` com `source`): sabemos
 * das sessões, mas não há garantia de aviso de conclusão — o "trabalhando" expira rápido.
 */
const COMMUNITY_CAPABILITIES: AgentCapabilities = {
  sessions: true, toolEvents: false, fileEvents: false, permissions: false,
  errors: false, completion: false, messages: false, mcp: false,
};

export function adapterForRoute(route: string): AgentAdapter | undefined {
  return ADAPTERS.find((a) => a.routes.includes(route));
}

export interface ProviderInfo {
  displayName: string;
  capabilities: AgentCapabilities;
}

/** Nome e capabilities de um provider — adapter oficial ou integração da comunidade */
export function providerInfo(provider: string): ProviderInfo {
  const adapter = ADAPTERS.find((a) => a.id === provider);
  return adapter
    ? { displayName: adapter.displayName, capabilities: adapter.capabilities }
    : { displayName: provider, capabilities: COMMUNITY_CAPABILITIES };
}
