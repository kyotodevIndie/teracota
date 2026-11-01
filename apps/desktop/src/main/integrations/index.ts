// Registro das integrações com agentes. Pra adicionar uma: crie a pasta do adapter,
// implemente AgentAdapter e inclua aqui (veja docs/INTEGRACOES.md).
import { SIM_PROVIDER_ID } from '@tera/agent-bridge';
import type { AgentProvider } from '@tera/agent-bridge';
import { claudeCode } from './claude-code/adapter';
import { createClaudeCodeProvider } from './claude-code/bridge-provider';
import type { AiBadge } from '../../shared/live';
import type { AgentAdapter, AgentCapabilities } from './types';

const DEFAULT_BADGE_COLOR = '#8a86a3';

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

/** Sessões do painel simulado: o roteiro cobre tudo, então vale o mesmo que um agente completo */
const SIMULATED_INFO: ProviderInfo = {
  displayName: 'Simulação',
  badge: { text: 'Si', color: DEFAULT_BADGE_COLOR },
  capabilities: {
    sessions: true, toolEvents: true, fileEvents: false, permissions: true,
    errors: true, completion: true, messages: true, mcp: false,
  },
};

export function adapterForRoute(route: string): AgentAdapter | undefined {
  return ADAPTERS.find((a) => a.routes.includes(route));
}

/** Integração cujos limites de uso chegam nesta rota */
export function adapterForUsageRoute(route: string): AgentAdapter | undefined {
  return ADAPTERS.find((a) => a.usage?.route === route);
}

export interface ProviderInfo {
  displayName: string;
  capabilities: AgentCapabilities;
  badge: AiBadge;
}


/** Nome e capabilities de um provider — adapter oficial ou integração da comunidade */
export function providerInfo(provider: string): ProviderInfo {
  const adapter = ADAPTERS.find((a) => a.id === provider);
  if (adapter) {
    return {
      displayName: adapter.displayName,
      capabilities: adapter.capabilities,
      badge: adapter.badge ?? { text: adapter.displayName.slice(0, 2), color: DEFAULT_BADGE_COLOR },
    };
  }
  if (provider === SIM_PROVIDER_ID) return SIMULATED_INFO;
  return { displayName: provider, capabilities: COMMUNITY_CAPABILITIES, badge: { text: provider.slice(0, 2), color: DEFAULT_BADGE_COLOR } };
}
