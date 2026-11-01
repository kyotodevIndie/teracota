// Plugins da Tera: o que um plugin declara (manifesto), o que pode pedir (permissões) e o
// que a interface mostra dele (cartões, ajustes). Especificação: docs/dev/plugins.md.
import type { AiBadge, UsageWindow } from './live';

/** Nome do manifesto na pasta do plugin */
export const PLUGIN_MANIFEST = 'teracota-plugin.json';

/**
 * Permissões. Cada uma vira uma frase na hora de ligar o plugin; sem a permissão, a
 * chamada correspondente da API é recusada.
 * - say: a Tera fala e muda de expressão
 * - cards: cartões na pilha "Agora"
 * - agent: sessões de um agente (aparecem como as do Claude Code) e limites de uso
 * - http: recebe eventos em POST 127.0.0.1:<porta>/plugins/<id>/...
 * - network:<host>: acessa esse site (só https)
 */
export type PluginPermission = 'say' | 'cards' | 'agent' | 'http' | `network:${string}`;

export interface PluginSetting {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'text';
  default: number | boolean | string;
  /** number: limites */
  min?: number;
  max?: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  /** Arquivo JS (relativo à pasta) que roda isolado, com a API `tera` */
  main: string;
  permissions: PluginPermission[];
  /** Sigla e cor (cartões, sessões e chip de uso do plugin) */
  badge: AiBadge;
  settings: PluginSetting[];
}

/** Estado de um plugin nos Ajustes */
export interface PluginStatus {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  badge: AiBadge;
  permissions: PluginPermission[];
  /** Ligado e com as permissões aprovadas */
  enabled: boolean;
  /** Pede permissões que o usuário ainda não aprovou (atualizou e pediu mais) */
  needsApproval: boolean;
  running: boolean;
  /** Manifesto inválido ou o plugin travou */
  error?: string;
  settings: PluginSetting[];
  values: Record<string, number | boolean | string>;
}

/** Um cartão de plugin na pilha "Agora" */
export interface PluginCard {
  plugin: string;
  id: string;
  title: string;
  line?: string;
  /** destaque do cartão */
  level: 'normal' | 'attention' | 'done';
  /** 0-1: barra de progresso */
  progress?: number;
  badge: AiBadge;
  pluginName: string;
}

/** Chamadas que a página do plugin faz ao app (preload → main) */
export type PluginCall =
  | { method: 'say'; text: string; expression?: string }
  | { method: 'card.set'; id: string; title: string; line?: string; level?: PluginCard['level']; progress?: number }
  | { method: 'card.remove'; id: string }
  | { method: 'session.update'; id: string; project: string; working?: boolean; activity?: string; request?: string | null }
  | { method: 'session.end'; id: string }
  | { method: 'usage.set'; windows: UsageWindow[] }
  | { method: 'log'; text: string };

export const PLUGIN_IPC = {
  call: 'tera-plugin:call',
  settings: 'tera-plugin:settings',
  /** Os ajustes na hora em que o plugin começa (síncrono: o código dele lê logo de cara) */
  settingsSync: 'tera-plugin:settings-sync',
  http: 'tera-plugin:http',
  ready: 'tera-plugin:ready',
} as const;

/** Frase de cada permissão pra quem vai aprovar */
export function describePermission(p: PluginPermission): string {
  if (p === 'say') return 'Fazer a Tera falar e mudar de expressão';
  if (p === 'cards') return 'Mostrar cartões na interface';
  if (p === 'agent') return 'Mostrar sessões de um agente e os limites de uso dele';
  if (p === 'http') return 'Receber eventos de programas deste computador';
  return `Acessar ${p.slice('network:'.length)}`;
}
