// Onde os plugins rodam. Cada plugin ligado ganha uma página escondida e isolada:
// sandbox do Chromium, sem Node, sessão própria (armazenamento separado), sem abrir janelas
// nem navegar, e a rede bloqueada fora dos sites que ele declarou (network:<host>). O código
// do plugin só fala com a Tera pela API `tera` do preload, e cada chamada é conferida aqui
// contra as permissões que o usuário aprovou.
//
// Um plugin com problema (manifesto inválido, travou, saiu do ar) vira um erro nos Ajustes;
// a Tera continua.
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, ipcMain, session } from 'electron';
import { EXPRESSIONS, type Expression } from '../../shared/protocol';
import type { AgentRequest, UsageWindow } from '../../shared/live';
import {
  PLUGIN_IPC, PLUGIN_MANIFEST, type PluginCall, type PluginCard, type PluginManifest, type PluginPermission, type PluginStatus,
} from '../../shared/plugins';
import type { PluginConfig } from '../config';
import { registerProvider } from '../integrations';
import type { AgentSignal } from '../integrations/types';
import { approvedAll, coerceSetting, parsePluginManifest } from './manifest';

/** Chamadas por segundo que um plugin pode fazer (o resto é descartado) */
const CALLS_PER_SECOND = 30;
/** Intervalo mínimo entre falas de um mesmo plugin */
const SAY_EVERY_MS = 3000;
const MAX_CARDS = 5;
const MAX_TEXT = 300;
const MAX_SCRIPT = 2 * 1024 * 1024;

export interface PluginHostDeps {
  /** Pasta com uma subpasta por plugin */
  dir: string;
  config(): Record<string, PluginConfig>;
  saveConfig(plugins: Record<string, PluginConfig>): void;
  say(text: string, expression: Expression | undefined, from: string): void;
  signal(signal: AgentSignal): void;
  usage(provider: string, windows: UsageWindow[]): void;
  /** Cartões, estados ou erros mudaram (a interface redesenha) */
  changed(): void;
}

interface Entry {
  dir: string;
  manifest?: PluginManifest;
  error?: string;
}

interface Running {
  win: BrowserWindow;
  manifest: PluginManifest;
  calls: number;
  windowStart: number;
  lastSay: number;
  sessions: Set<string>;
}

const clip = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Confere uma chamada do plugin (formato e permissão); null = recusada */
export function checkCall(call: unknown, permissions: readonly PluginPermission[]): PluginCall | null {
  const c = (call ?? {}) as Record<string, unknown>;
  const has = (p: PluginPermission) => permissions.includes(p);
  const id = typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) ? c.id : null;
  switch (c.method) {
    case 'log':
      return { method: 'log', text: clip(c.text, 1000) };
    case 'say':
      if (!has('say') || !clip(c.text)) return null;
      return { method: 'say', text: clip(c.text), ...(EXPRESSIONS.includes(c.expression as Expression) && { expression: c.expression as string }) };
    case 'card.set': {
      if (!has('cards') || !id || !clip(c.title, 80)) return null;
      const level = c.level === 'attention' || c.level === 'done' ? c.level : 'normal';
      const progress = typeof c.progress === 'number' && Number.isFinite(c.progress) ? Math.min(1, Math.max(0, c.progress)) : undefined;
      return { method: 'card.set', id, title: clip(c.title, 80), ...(clip(c.line, 160) && { line: clip(c.line, 160) }), level, ...(progress !== undefined && { progress }) };
    }
    case 'card.remove':
      return has('cards') && id ? { method: 'card.remove', id } : null;
    case 'session.update':
      if (!has('agent') || !id || !clip(c.project, 60)) return null;
      return {
        method: 'session.update', id, project: clip(c.project, 60),
        ...(typeof c.working === 'boolean' && { working: c.working }),
        ...(typeof c.activity === 'string' && { activity: clip(c.activity, 90) }),
        ...((c.request === null || typeof c.request === 'string') && { request: c.request === null ? null : clip(c.request, 200) }),
      };
    case 'session.end':
      return has('agent') && id ? { method: 'session.end', id } : null;
    case 'usage.set': {
      if (!has('agent') || !Array.isArray(c.windows)) return null;
      const windows: UsageWindow[] = [];
      for (const w of c.windows.slice(0, 3) as Record<string, unknown>[]) {
        if (!['five_hour', 'seven_day', 'spend_limit'].includes(w?.id as string) || typeof w.usedPct !== 'number' || !Number.isFinite(w.usedPct)) return null;
        const resetsAt = typeof w.resetsAt === 'number' && Number.isFinite(w.resetsAt) ? w.resetsAt : null;
        windows.push({ id: w.id as UsageWindow['id'], usedPct: Math.max(0, Math.min(999, w.usedPct)), resetsAt });
      }
      return { method: 'usage.set', windows };
    }
    default:
      return null;
  }
}

/** A URL pode ser acessada pela página do plugin? (só https pros hosts declarados, e a própria página) */
export function allowedUrl(url: string, permissions: readonly PluginPermission[], hostPage: string): boolean {
  if (url === hostPage || url.startsWith('devtools://')) return true;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return permissions.some((p) => p.startsWith('network:') && p.slice('network:'.length) === u.hostname);
}

export class PluginHost {
  private entries: Entry[] = [];
  private readonly running = new Map<string, Running>();
  private readonly errors = new Map<string, string>();
  private readonly cards = new Map<string, PluginCard>();
  private readonly hostPage: string;

  constructor(private readonly deps: PluginHostDeps, private readonly distDir: string) {
    this.hostPage = `file://${path.join(distDir, 'renderer', 'plugin-host.html').split(path.sep).join('/')}`;
    ipcMain.on(PLUGIN_IPC.call, (e, call: unknown) => this.onCall(e.sender, call));
    ipcMain.on(PLUGIN_IPC.settingsSync, (e) => {
      const r = [...this.running.values()].find((x) => !x.win.isDestroyed() && x.win.webContents === e.sender);
      e.returnValue = r ? this.values(r.manifest) : null;
    });
  }

  get pluginsDir(): string {
    return this.deps.dir;
  }

  /** Lê as pastas de plugin (de novo) e liga os que estavam ligados */
  start(): void {
    fs.mkdirSync(this.deps.dir, { recursive: true });
    this.entries = this.scan();
    for (const e of this.entries) {
      const cfg = this.deps.config()[e.manifest?.id ?? ''];
      if (e.manifest && cfg?.enabled && approvedAll(e.manifest.permissions, cfg.approved)) this.run(e.manifest, e.dir);
    }
    this.deps.changed();
  }

  /** Relê a pasta: plugins novos aparecem; os que sumiram param */
  rescan(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
    this.errors.clear();
    this.start();
  }

  private scan(): Entry[] {
    const out: Entry[] = [];
    let dirs: fs.Dirent[] = [];
    try { dirs = fs.readdirSync(this.deps.dir, { withFileTypes: true }); } catch { return out; }
    const seen = new Set<string>();
    for (const d of dirs.filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = path.join(this.deps.dir, d.name);
      const file = path.join(dir, PLUGIN_MANIFEST);
      if (!fs.existsSync(file)) continue;
      let parsed: ReturnType<typeof parsePluginManifest>;
      try {
        parsed = parsePluginManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (err) {
        parsed = { error: `${PLUGIN_MANIFEST} não é um JSON válido: ${(err as Error).message}` };
      }
      if (parsed.manifest && seen.has(parsed.manifest.id)) parsed = { error: `id repetido: ${parsed.manifest.id}` };
      if (parsed.manifest) seen.add(parsed.manifest.id);
      out.push({ dir, ...parsed });
    }
    return out;
  }

  status(): PluginStatus[] {
    const cfg = this.deps.config();
    return this.entries.map((e): PluginStatus => {
      if (!e.manifest) {
        const name = path.basename(e.dir);
        return {
          id: `pasta:${name}`, name, version: '', description: '', badge: { text: '!', color: '#f87171' }, permissions: [],
          enabled: false, needsApproval: false, running: false, error: e.error, settings: [], values: {},
        };
      }
      const m = e.manifest;
      const c = cfg[m.id];
      const values = Object.fromEntries(m.settings.map((s) => [s.key, coerceSetting(s, c?.values[s.key] ?? s.default)]));
      return {
        id: m.id, name: m.name, version: m.version, description: m.description, ...(m.author && { author: m.author }),
        badge: m.badge, permissions: m.permissions,
        enabled: !!c?.enabled && approvedAll(m.permissions, c.approved),
        needsApproval: !!c?.enabled && !approvedAll(m.permissions, c.approved),
        running: this.running.has(m.id),
        ...(this.errors.has(m.id) && { error: this.errors.get(m.id) }),
        settings: m.settings, values,
      };
    });
  }

  listCards(): PluginCard[] {
    return [...this.cards.values()];
  }

  /** Ligar = aprovar as permissões que ele pede agora */
  setEnabled(id: string, on: boolean): boolean {
    const e = this.entries.find((x) => x.manifest?.id === id);
    if (!e?.manifest) return false;
    const all = { ...this.deps.config() };
    const prev = all[id] ?? { enabled: false, approved: [], values: {} };
    all[id] = on ? { ...prev, enabled: true, approved: [...e.manifest.permissions] } : { ...prev, enabled: false };
    this.deps.saveConfig(all);
    this.errors.delete(id);
    if (on) this.run(e.manifest, e.dir);
    else this.stop(id);
    this.deps.changed();
    return true;
  }

  setValue(id: string, key: string, value: unknown): boolean {
    const m = this.entries.find((x) => x.manifest?.id === id)?.manifest;
    const setting = m?.settings.find((s) => s.key === key);
    if (!m || !setting) return false;
    const all = { ...this.deps.config() };
    const prev = all[id] ?? { enabled: false, approved: [], values: {} };
    all[id] = { ...prev, values: { ...prev.values, [key]: coerceSetting(setting, value) } };
    this.deps.saveConfig(all);
    const r = this.running.get(id);
    if (r) r.win.webContents.send(PLUGIN_IPC.settings, this.values(m));
    this.deps.changed();
    return true;
  }

  /** POST /plugins/<id>/... vindo do servidor local */
  http(id: string, subpath: string, body: unknown): boolean {
    const r = this.running.get(id);
    if (!r?.manifest.permissions.includes('http')) return false;
    r.win.webContents.send(PLUGIN_IPC.http, { path: subpath.slice(0, 200), body });
    return true;
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }

  private values(m: PluginManifest): Record<string, number | boolean | string> {
    const c = this.deps.config()[m.id];
    return Object.fromEntries(m.settings.map((s) => [s.key, coerceSetting(s, c?.values[s.key] ?? s.default)]));
  }

  private run(m: PluginManifest, dir: string): void {
    if (this.running.has(m.id)) return;
    const scriptFile = path.join(dir, m.main);
    let source: string;
    try {
      if (!path.resolve(scriptFile).startsWith(path.resolve(dir) + path.sep)) throw new Error('"main" fora da pasta');
      if (fs.statSync(scriptFile).size > MAX_SCRIPT) throw new Error('"main" grande demais');
      source = fs.readFileSync(scriptFile, 'utf8');
    } catch (err) {
      this.errors.set(m.id, `não consegui ler ${m.main}: ${(err as Error).message}`);
      return;
    }

    const ses = session.fromPartition(`persist:plugin-${m.id}`);
    ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !allowedUrl(details.url, m.permissions, this.hostPage) }));
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());

    const win = new BrowserWindow({
      show: false,
      width: 200,
      height: 200,
      webPreferences: {
        preload: path.join(this.distDir, 'plugin-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        session: ses,
        webviewTag: false,
        spellcheck: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('render-process-gone', (_e, d) => {
      this.errors.set(m.id, `o plugin parou (${d.reason})`);
      this.stop(m.id);
      this.deps.changed();
    });
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error') console.error(`[plugin ${m.id}] ${e.message}`);
    });
    registerProvider(m.id, {
      displayName: m.name,
      badge: m.badge,
      capabilities: { sessions: true, toolEvents: false, fileEvents: false, permissions: false, errors: false, completion: true, messages: false, mcp: false },
    });
    this.running.set(m.id, { win, manifest: m, calls: 0, windowStart: Date.now(), lastSay: 0, sessions: new Set() });
    win.loadURL(this.hostPage).then(async () => {
      // o código roda no mundo da página (sem Node); a API chega pelo preload
      await win.webContents.executeJavaScript(`(() => {\n${source}\n})();\n//# sourceURL=plugin://${m.id}/${m.main}`);
    }).catch((err: Error) => {
      this.errors.set(m.id, `erro ao iniciar: ${err.message}`);
      this.stop(m.id);
      this.deps.changed();
    });
  }

  private stop(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    this.running.delete(id);
    if (!r.win.isDestroyed()) r.win.destroy();
    for (const key of [...this.cards.keys()]) if (key.startsWith(`${id}/`)) this.cards.delete(key);
    for (const s of r.sessions) this.deps.signal({ source: { provider: id, sessionId: s, project: s }, lifecycle: 'end', working: false, event: null });
    this.deps.usage(id, []);
    registerProvider(id, null);
  }

  private onCall(sender: Electron.WebContents, raw: unknown): void {
    const r = [...this.running.values()].find((x) => !x.win.isDestroyed() && x.win.webContents === sender);
    if (!r) return;
    const now = Date.now();
    if (now - r.windowStart > 1000) {
      r.windowStart = now;
      r.calls = 0;
    }
    if (++r.calls > CALLS_PER_SECOND) return;
    const call = checkCall(raw, r.manifest.permissions);
    if (!call) {
      console.warn(`[plugin ${r.manifest.id}] chamada recusada: ${JSON.stringify(raw).slice(0, 120)}`);
      return;
    }
    const m = r.manifest;
    switch (call.method) {
      case 'log':
        console.log(`[plugin ${m.id}] ${call.text}`);
        return;
      case 'say':
        if (now - r.lastSay < SAY_EVERY_MS) return;
        r.lastSay = now;
        this.deps.say(call.text, call.expression as Expression | undefined, m.name);
        return;
      case 'card.set': {
        const key = `${m.id}/${call.id}`;
        if (!this.cards.has(key) && [...this.cards.keys()].filter((k) => k.startsWith(`${m.id}/`)).length >= MAX_CARDS) return;
        this.cards.set(key, {
          plugin: m.id, pluginName: m.name, badge: m.badge, id: call.id, title: call.title, level: call.level ?? 'normal',
          ...(call.line && { line: call.line }), ...(call.progress !== undefined && { progress: call.progress }),
        });
        this.deps.changed();
        return;
      }
      case 'card.remove':
        if (this.cards.delete(`${m.id}/${call.id}`)) this.deps.changed();
        return;
      case 'session.update': {
        r.sessions.add(call.id);
        const request: AgentRequest | null | undefined = call.request === undefined ? undefined
          : call.request === null ? null : { kind: 'question', message: call.request, at: now };
        this.deps.signal({
          source: { provider: m.id, sessionId: call.id, project: call.project },
          ...(call.working !== undefined && { working: call.working }),
          ...(call.activity !== undefined && { activity: call.activity ? { kind: 'thinking', detail: call.activity } : null }),
          ...(request !== undefined && { request }),
          event: null,
        });
        return;
      }
      case 'session.end':
        if (!r.sessions.delete(call.id)) return;
        this.deps.signal({ source: { provider: m.id, sessionId: call.id, project: call.id }, lifecycle: 'end', working: false, event: null });
        return;
      case 'usage.set':
        this.deps.usage(m.id, call.windows);
        return;
    }
  }
}
