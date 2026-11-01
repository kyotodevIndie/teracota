// Ajustes: tema e vidro da interface, como a Tera se mexe, e os agentes (conectar, falar
// pela Tera, limites do Claude). O main guarda tudo; aqui só se desenha e se pede.
import type { AgentConnection, AppPanelApi, PanelResultLike } from '../shared/app-panel';
import { THEMES, type PrefsPatch, type ThemeId, type UiPrefs } from '../shared/live';
import { describePermission, type PluginStatus } from '../shared/plugins';
import { aiIcon } from './panel-live';

const THEME_INFO: Record<ThemeId, { name: string; swatch: string }> = {
  vidro: { name: 'Vidro', swatch: 'linear-gradient(135deg, rgba(24,20,34,.9), rgba(60,54,80,.75))' },
  aurora: { name: 'Aurora', swatch: 'linear-gradient(135deg, #e8875f, #6d4fa8 60%, #1e1426)' },
  claro: { name: 'Claro', swatch: 'linear-gradient(135deg, #ffffff, #e9e4f5)' },
  contraste: { name: 'Contraste', swatch: 'linear-gradient(135deg, #000 50%, #ffd000 50%)' },
};

const STATUS_TEXT: Record<AgentConnection['status'], string> = {
  connected: 'Conectado',
  available: 'Instalado, não conectado',
  unavailable: 'Não encontrado',
};

export interface SettingsView {
  refreshAgents(): Promise<void>;
}

export function mountSettings(opts: {
  api: AppPanelApi;
  unwrap<T>(r: PanelResultLike<T>): T | undefined;
  /** Tema mudou (o terminal troca as cores junto) */
  onTheme(theme: ThemeId): void;
  changed(): void;
}): SettingsView {
  const { api, unwrap } = opts;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const themes = $('themes');
  const glass = $<HTMLInputElement>('glass');
  const glassValue = $('glass-value');
  const reduced = $<HTMLInputElement>('reduced');
  const multi = $<HTMLInputElement>('multi');
  const roam = $<HTMLButtonElement>('move-roam');
  const stay = $<HTMLButtonElement>('move-stay');
  const usageSources = $('usage-sources');
  const agentList = $('agent-list');
  let prefs: UiPrefs | null = null;

  function apply(p: UiPrefs): void {
    prefs = p;
    document.documentElement.dataset.theme = p.theme;
    document.documentElement.style.setProperty('--glass', String(p.glass));
    for (const b of themes.children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.theme === p.theme));
    glass.value = String(p.glass);
    glassValue.textContent = `${Math.round(p.glass * 100)}%`;
    reduced.checked = p.reducedMotion;
    multi.checked = p.entityMode === 'multi';
    roam.setAttribute('aria-pressed', String(p.moveMode === 'roam'));
    stay.setAttribute('aria-pressed', String(p.moveMode === 'stay'));
    // um liga/desliga por IA que sabe mandar os limites (ex.: o Claude pela statusline)
    usageSources.replaceChildren(...p.usageSources.map((u) => {
      const row = document.createElement('label');
      row.className = 'card glass hit toggle';
      const text = document.createElement('span');
      text.className = 'grow';
      const title = document.createElement('strong');
      title.textContent = u.label;
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = u.description;
      text.append(title, note);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = u.enabled;
      box.dataset.testid = `usage-source-${u.provider}`;
      box.onchange = () => void set({ usage: { provider: u.provider, on: box.checked } });
      row.append(text, box);
      return row;
    }));
    opts.onTheme(p.theme);
    opts.changed();
  }

  async function set(patch: PrefsPatch): Promise<void> {
    const next = unwrap(await api.setPrefs(patch));
    if (next) apply(next);
    else if (prefs) apply(prefs); // falhou: volta os controles pro que vale
  }

  themes.replaceChildren(...THEMES.map((id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme';
    b.dataset.theme = id;
    b.dataset.testid = `theme-${id}`;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = THEME_INFO[id].swatch;
    b.append(sw, THEME_INFO[id].name);
    b.onclick = () => void set({ theme: id });
    return b;
  }));
  // o vidro muda na hora enquanto arrasta; salva ao soltar
  glass.oninput = () => {
    document.documentElement.style.setProperty('--glass', glass.value);
    glassValue.textContent = `${Math.round(Number(glass.value) * 100)}%`;
  };
  glass.onchange = () => void set({ glass: Number(glass.value) });
  reduced.onchange = () => void set({ reducedMotion: reduced.checked });
  multi.onchange = () => void set({ entityMode: multi.checked ? 'multi' : 'single' });
  roam.onclick = () => void set({ moveMode: 'roam' });
  stay.onclick = () => void set({ moveMode: 'stay' });
  api.onPrefs(apply);
  void api.prefs().then((r) => {
    const p = unwrap(r);
    if (p) apply(p);
  });

  // ---------- agentes ----------
  let busy = false;
  let last: AgentConnection[] = [];

  const button = (text: string, testid: string, onClick: () => Promise<void> | void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.dataset.testid = testid;
    b.disabled = busy;
    b.onclick = () => void onClick();
    return b;
  };

  async function action(fn: () => Promise<PanelResultLike<AgentConnection[] | null>>): Promise<void> {
    busy = true;
    renderAgents(last);
    const data = unwrap(await fn());
    busy = false;
    if (Array.isArray(data)) last = data;
    renderAgents(last);
    // conectar pode ter mudado se dá pra ligar os limites
    const p = unwrap(await api.prefs());
    if (p) apply(p);
  }

  function renderAgents(list: AgentConnection[]): void {
    agentList.replaceChildren(...list.map((a) => {
      const li = document.createElement('li');
      li.className = 'agent';
      li.dataset.testid = `agent-${a.id}`;
      const name = document.createElement('span');
      name.className = 'agent-name';
      name.textContent = a.displayName;
      const status = document.createElement('span');
      status.className = 'status';
      status.dataset.status = a.status;
      status.textContent = STATUS_TEXT[a.status];
      const actions = document.createElement('div');
      actions.className = 'agent-actions';
      if (a.status !== 'connected') {
        actions.append(button(a.status === 'available' ? a.label : 'Tentar conectar', 'connect', () => action(() => api.connect(a.id))));
      }
      if (a.status === 'connected' && a.openSessionsCommand) {
        const cmd = a.openSessionsCommand;
        actions.append(button(`Copiar ${cmd} (sessões já abertas)`, 'copy-open-sessions', async () => { unwrap(await api.copyOpenSessions(a.id)); }));
      }
      if (a.speech !== null) {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = a.speech;
        box.disabled = busy;
        box.dataset.testid = 'speech';
        box.onchange = () => void action(() => api.setSpeech(a.id, box.checked));
        label.append(box, 'Falar pela Tera (MCP)');
        actions.append(label);
      }
      li.append(name, status, actions);
      return li;
    }));
    opts.changed();
  }

  // ---------- plugins ----------
  const pluginList = $('plugin-list');
  /** Plugin com a confirmação de permissões aberta */
  let confirming: string | null = null;

  function renderPlugins(list: PluginStatus[]): void {
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'card glass hit empty';
      empty.textContent = 'Nenhum plugin. Coloque a pasta de um plugin na pasta de plugins e clique em "Procurar de novo".';
      pluginList.replaceChildren(empty);
      opts.changed();
      return;
    }
    pluginList.replaceChildren(...list.map((p) => {
      const card = document.createElement('div');
      card.className = 'card glass hit plugin';
      card.dataset.testid = `plugin-${p.id}`;
      const head = document.createElement('div');
      head.className = 'plugin-head';
      const text = document.createElement('span');
      text.className = 'grow';
      const title = document.createElement('strong');
      title.textContent = p.version ? `${p.name} ${p.version}` : p.name;
      const desc = document.createElement('span');
      desc.className = 'note';
      desc.textContent = p.description || (p.author ? `por ${p.author}` : '');
      text.append(title, desc);
      head.append(aiIcon(p.badge), text);
      card.append(head);
      if (p.error) {
        const err = document.createElement('div');
        err.className = 'err';
        err.textContent = p.error;
        card.append(err);
      }
      if (p.id.startsWith('pasta:')) return card;

      if (confirming === p.id) {
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = p.permissions.length ? 'Ao ligar, este plugin vai poder:' : 'Este plugin não pede nenhuma permissão.';
        const perms = document.createElement('ul');
        perms.className = 'perms';
        for (const perm of p.permissions) {
          const li = document.createElement('li');
          li.textContent = describePermission(perm);
          perms.append(li);
        }
        const row = document.createElement('div');
        row.className = 'row';
        const ok = button('Ligar e permitir', 'plugin-approve', async () => {
          confirming = null;
          const r = unwrap(await api.setPlugin(p.id, true));
          if (r) renderPlugins(r);
        });
        ok.className = 'primary';
        const cancel = button('Cancelar', 'plugin-cancel', () => {
          confirming = null;
          renderPlugins(list);
        });
        cancel.className = 'ghost';
        row.append(cancel, ok);
        card.append(note, perms, row);
        return card;
      }

      const toggle = document.createElement('label');
      toggle.className = 'row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = p.enabled;
      box.dataset.testid = `plugin-toggle-${p.id}`;
      box.onchange = async () => {
        if (box.checked) {
          // ligar sempre passa pela lista de permissões
          confirming = p.id;
          renderPlugins(list);
          return;
        }
        const r = unwrap(await api.setPlugin(p.id, false));
        if (r) renderPlugins(r);
      };
      toggle.append(box, p.needsApproval ? 'Pede permissões novas: revise pra ligar' : p.enabled ? (p.running ? 'Ligado' : 'Ligado (parado)') : 'Desligado');
      card.append(toggle);

      if (p.enabled) {
        for (const s of p.settings) {
          const row = document.createElement('label');
          row.className = 'setting';
          const name = document.createElement('span');
          name.textContent = s.label;
          const input = document.createElement('input');
          const value = p.values[s.key] ?? s.default;
          if (s.type === 'boolean') {
            input.type = 'checkbox';
            input.checked = value === true;
            input.onchange = async () => { unwrap(await api.setPluginValue(p.id, s.key, input.checked)); };
          } else {
            input.type = s.type === 'number' ? 'number' : 'text';
            if (s.min !== undefined) input.min = String(s.min);
            if (s.max !== undefined) input.max = String(s.max);
            input.value = String(value);
            input.onchange = async () => {
              unwrap(await api.setPluginValue(p.id, s.key, s.type === 'number' ? Number(input.value) : input.value));
            };
          }
          row.append(name, input);
          card.append(row);
        }
      }
      return card;
    }));
    opts.changed();
  }

  $('plugins-folder').onclick = () => void api.openPluginsFolder();
  $('plugins-rescan').onclick = async () => {
    const r = unwrap(await api.rescanPlugins());
    if (r) renderPlugins(r);
  };
  api.onPlugins((list) => {
    // não refaz a lista enquanto alguém digita num ajuste
    if (!pluginList.contains(document.activeElement) || !(document.activeElement as HTMLElement).matches('input[type="number"], input[type="text"]')) renderPlugins(list);
  });
  void api.plugins().then((r) => {
    const list = unwrap(r);
    if (list) renderPlugins(list);
  });

  return {
    async refreshAgents() {
      if (busy) return;
      const data = unwrap(await api.connections());
      if (data) {
        last = data;
        renderAgents(data);
      }
    },
  };
}
