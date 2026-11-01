// Preload das páginas de plugin: a única ponte entre o código do plugin e a Tera é o
// objeto `tera` (o plugin não enxerga ipcRenderer, Node nem o app). Cada chamada é
// conferida de novo no main contra as permissões aprovadas.
import { contextBridge, ipcRenderer } from 'electron';
import { PLUGIN_IPC } from '../shared/plugins';

type Values = Record<string, number | boolean | string>;

let settings: Values | null = null;
const current = (): Values => {
  settings ??= (ipcRenderer.sendSync(PLUGIN_IPC.settingsSync) as Values | null) ?? {};
  return settings;
};
const settingsListeners: ((v: Values) => void)[] = [];
const httpListeners: ((e: { path: string; body: unknown }) => void)[] = [];

ipcRenderer.on(PLUGIN_IPC.settings, (_e, v: Values) => {
  settings = v;
  for (const cb of settingsListeners) cb({ ...v });
});
ipcRenderer.on(PLUGIN_IPC.http, (_e, ev: { path: string; body: unknown }) => {
  for (const cb of httpListeners) cb(ev);
});

const call = (payload: Record<string, unknown>) => ipcRenderer.send(PLUGIN_IPC.call, payload);

contextBridge.exposeInMainWorld('tera', {
  /** Faz a Tera falar (permissão "say") */
  say: (text: string, opts: { expression?: string } = {}) => call({ method: 'say', text, expression: opts.expression }),
  /** Cartões na pilha "Agora" (permissão "cards") */
  card: {
    set: (id: string, card: { title: string; line?: string; level?: string; progress?: number }) => call({ method: 'card.set', id, ...card }),
    remove: (id: string) => call({ method: 'card.remove', id }),
  },
  /** Sessões de um agente (permissão "agent") */
  session: {
    update: (id: string, s: { project: string; working?: boolean; activity?: string; request?: string | null }) => call({ method: 'session.update', id, ...s }),
    end: (id: string) => call({ method: 'session.end', id }),
  },
  /** Limites de uso: o chip do plugin no topo (permissão "agent") */
  usage: {
    set: (windows: { id: string; usedPct: number; resetsAt?: number | null }[]) => call({ method: 'usage.set', windows }),
  },
  /** Valores dos ajustes do plugin (mudam quando o usuário mexe nos Ajustes) */
  get settings(): Values {
    return { ...current() };
  },
  onSettings: (cb: (v: Values) => void) => { settingsListeners.push(cb); },
  /** Eventos de POST 127.0.0.1:<porta>/plugins/<id>/... (permissão "http") */
  onHttp: (cb: (e: { path: string; body: unknown }) => void) => { httpListeners.push(cb); },
  log: (text: string) => call({ method: 'log', text: String(text) }),
});
