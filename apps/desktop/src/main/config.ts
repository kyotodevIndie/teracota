// Preferências persistidas: modos e última posição da Tera principal.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { EntityMode, MoveMode } from '../shared/ipc';
import { THEMES, type ThemeId } from '../shared/live';
import type { StoredDevice } from './remote/server';

export interface Config {
  moveMode: MoveMode;
  entityMode: EntityMode;
  /** id da skin; ausente = primeira disponível */
  skin?: string;
  /** Já se apresentou na primeira execução */
  onboarded?: boolean;
  /** Já ofereceu conectar a um agente (ou ele já estava conectado) */
  connectOffered?: boolean;
  x?: number;
  y?: number;
  /** Movimento reduzido pedido no menu */
  reducedMotion?: boolean;
  /** Tema da interface; ausente = padrão */
  uiTheme?: ThemeId;
  /** Opacidade do vidro dos cartões; ausente = padrão */
  uiGlass?: number;
  /** Plugins: ligado, permissões aprovadas e valores dos ajustes, por id */
  plugins?: Record<string, PluginConfig>;
  /** Tera no celular (rede de casa): ligado e os celulares pareados (com a chave de cada um) */
  remote?: { enabled: boolean; devices: StoredDevice[] };
}

function parseRemote(raw: unknown): Config['remote'] {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') return undefined;
  const devices = (Array.isArray(o.devices) ? o.devices : []).filter((d): d is StoredDevice => {
    const x = d as Record<string, unknown>;
    return typeof x?.id === 'string' && typeof x.name === 'string' && typeof x.key === 'string' && typeof x.pairedAt === 'number';
  });
  return { enabled: o.enabled === true, devices };
}

export interface PluginConfig {
  enabled: boolean;
  /** Permissões que o usuário aprovou ao ligar */
  approved: string[];
  values: Record<string, number | boolean | string>;
}

function parsePlugins(raw: unknown): Record<string, PluginConfig> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, PluginConfig> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = (v ?? {}) as Record<string, unknown>;
    const values: PluginConfig['values'] = {};
    for (const [k, x] of Object.entries((o.values ?? {}) as Record<string, unknown>)) {
      if (typeof x === 'number' || typeof x === 'boolean' || typeof x === 'string') values[k] = x;
    }
    out[id] = {
      enabled: o.enabled === true,
      approved: Array.isArray(o.approved) ? o.approved.filter((p): p is string => typeof p === 'string') : [],
      values,
    };
  }
  return out;
}

/** Opacidade do vidro aceita (fora disso o texto some ou vira um bloco opaco) */
export const GLASS_RANGE = { min: 0.4, max: 0.95 } as const;

const file = () => path.join(app.getPath('userData'), 'config.json');
/** Onde a config ficava com os nomes antigos do app (o mais recente primeiro) */
const LEGACY_DIRS = ['Terracota', 'waifu-claude'];

/** Config atual ou, na primeira execução depois de renomear o app, a do nome antigo */
function configSource(): string {
  if (fs.existsSync(file())) return file();
  const legacy = LEGACY_DIRS.map((dir) => path.join(app.getPath('appData'), dir, 'config.json')).find((f) => fs.existsSync(f));
  return legacy ?? file();
}

export function loadConfig(): Config {
  try {
    const source = configSource();
    const raw = JSON.parse(fs.readFileSync(source, 'utf8')) as Partial<Config> & { mode?: string };
    const moveMode = raw.moveMode ?? raw.mode; // 'mode' era o nome antigo
    return {
      moveMode: moveMode === 'stay' ? 'stay' : 'roam',
      entityMode: raw.entityMode === 'multi' ? 'multi' : 'single',
      ...(typeof raw.skin === 'string' && { skin: raw.skin }),
      ...(raw.onboarded === true && { onboarded: true }),
      ...(raw.connectOffered === true && { connectOffered: true }),
      ...(typeof raw.x === 'number' && typeof raw.y === 'number' && { x: raw.x, y: raw.y }),
      ...(raw.reducedMotion === true && { reducedMotion: true }),
      ...(THEMES.includes(raw.uiTheme as ThemeId) && { uiTheme: raw.uiTheme }),
      ...(parsePlugins(raw.plugins) && { plugins: parsePlugins(raw.plugins) }),
      ...(parseRemote(raw.remote) && { remote: parseRemote(raw.remote) }),
      ...(typeof raw.uiGlass === 'number' && raw.uiGlass >= GLASS_RANGE.min && raw.uiGlass <= GLASS_RANGE.max && { uiGlass: raw.uiGlass }),
      // `ui`, `companion` e `companionMuted` eram do Mini Companion (removido): são descartados,
      // e quem estava no modo mini volta pra Tera completa
    };
  } catch {
    return { moveMode: 'roam', entityMode: 'single' };
  }
}

let saveTimer: NodeJS.Timeout | undefined;

export function saveConfig(config: Config): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(file(), JSON.stringify(config, null, 2));
    } catch (err) {
      console.error('[teracota] não consegui salvar config:', err);
    }
  }, 500);
}
