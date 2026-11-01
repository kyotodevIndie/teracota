// Leitura e validação do manifesto de um plugin (teracota-plugin.json). Tudo que vem da
// pasta do plugin é suspeito: ids, caminhos e permissões passam por aqui antes de valer.
import { SIM_PROVIDER_ID } from '@tera/agent-bridge';
import type { PluginManifest, PluginPermission, PluginSetting } from '../../shared/plugins';
import { ADAPTERS } from '../integrations';

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SETTING_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_SETTINGS = 20;

/** Ids que não podem ser de plugin: os agentes oficiais, o simulado e nomes do core */
export const RESERVED_IDS = new Set([...ADAPTERS.map((a) => a.id), SIM_PROVIDER_ID, 'teracota', 'tera', 'api', 'event', 'mcp', 'hook', 'health', 'usage']);

export type ManifestResult = { manifest: PluginManifest; error?: undefined } | { manifest?: undefined; error: string };

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);

/** Caminho relativo seguro pra um .js dentro da pasta do plugin */
export function isSafeScript(p: unknown): p is string {
  if (typeof p !== 'string' || !p.endsWith('.js')) return false;
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-z]:/i.test(p) || p.includes('://')) return false;
  return !p.split(/[\\/]/).some((seg) => seg === '..' || seg === '' || seg === '.');
}

export function parsePermission(p: unknown): PluginPermission | null {
  if (p === 'say' || p === 'cards' || p === 'agent' || p === 'http') return p;
  if (typeof p === 'string' && p.startsWith('network:') && HOST.test(p.slice('network:'.length))) return p as PluginPermission;
  return null;
}

function parseSetting(s: unknown): PluginSetting | null {
  const o = (s ?? {}) as Record<string, unknown>;
  const key = typeof o.key === 'string' && SETTING_KEY.test(o.key) ? o.key : null;
  const label = text(o.label, 80);
  if (!key || !label) return null;
  if (o.type === 'number' && typeof o.default === 'number' && Number.isFinite(o.default)) {
    const min = typeof o.min === 'number' ? o.min : undefined;
    const max = typeof o.max === 'number' ? o.max : undefined;
    return { key, label, type: 'number', default: o.default, ...(min !== undefined && { min }), ...(max !== undefined && { max }) };
  }
  if (o.type === 'boolean' && typeof o.default === 'boolean') return { key, label, type: 'boolean', default: o.default };
  if (o.type === 'text' && typeof o.default === 'string' && o.default.length <= 500) return { key, label, type: 'text', default: o.default };
  return null;
}

export function parsePluginManifest(input: unknown): ManifestResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'o manifesto não é um objeto JSON' };
  const o = input as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID.test(o.id)) return { error: '"id" deve ter de 2 a 40 letras minúsculas, números e -' };
  if (RESERVED_IDS.has(o.id)) return { error: `"id" ${o.id} é reservado` };
  const name = text(o.name, 60);
  if (!name) return { error: '"name" é obrigatório (até 60 caracteres)' };
  const version = typeof o.version === 'string' && /^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(o.version) ? o.version : null;
  if (!version) return { error: '"version" deve ser semver (ex.: 0.1.0)' };
  if (!isSafeScript(o.main)) return { error: '"main" deve ser um .js dentro da pasta do plugin' };
  const rawPerms = Array.isArray(o.permissions) ? o.permissions : [];
  const permissions: PluginPermission[] = [];
  for (const p of rawPerms) {
    const parsed = parsePermission(p);
    if (!parsed) return { error: `permissão desconhecida: ${String(p)}` };
    if (!permissions.includes(parsed)) permissions.push(parsed);
  }
  const badgeRaw = (o.badge ?? {}) as Record<string, unknown>;
  const badge = {
    text: typeof badgeRaw.text === 'string' && badgeRaw.text.length >= 1 && badgeRaw.text.length <= 2 ? badgeRaw.text : name.slice(0, 2),
    color: typeof badgeRaw.color === 'string' && COLOR.test(badgeRaw.color) ? badgeRaw.color : '#8a86a3',
  };
  const rawSettings = Array.isArray(o.settings) ? o.settings.slice(0, MAX_SETTINGS) : [];
  const settings: PluginSetting[] = [];
  for (const s of rawSettings) {
    const parsed = parseSetting(s);
    if (!parsed) return { error: `ajuste inválido: ${JSON.stringify(s).slice(0, 80)}` };
    if (settings.some((x) => x.key === parsed.key)) return { error: `ajuste repetido: ${parsed.key}` };
    settings.push(parsed);
  }
  return {
    manifest: {
      id: o.id,
      name,
      version,
      description: text(o.description, 200) ?? '',
      ...(text(o.author, 80) && { author: text(o.author, 80)! }),
      main: o.main,
      permissions,
      badge,
      settings,
    },
  };
}

/** Valor de ajuste vindo da interface: do tipo certo e nos limites; senão, o padrão */
export function coerceSetting(s: PluginSetting, v: unknown): number | boolean | string {
  if (s.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return s.default;
    return Math.min(s.max ?? Number.POSITIVE_INFINITY, Math.max(s.min ?? Number.NEGATIVE_INFINITY, v));
  }
  if (s.type === 'boolean') return typeof v === 'boolean' ? v : s.default;
  return typeof v === 'string' ? v.slice(0, 500) : s.default;
}

/** As permissões pedidas estão todas aprovadas? */
export const approvedAll = (wanted: PluginPermission[], approved: string[] | undefined) =>
  wanted.every((p) => approved?.includes(p));
