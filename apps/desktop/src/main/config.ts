// Preferências persistidas: modos e última posição da Tera principal.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { EntityMode, MoveMode } from '../shared/ipc';

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
}

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
