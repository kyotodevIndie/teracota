// Renderer do painel de conversa (experimental). Todo texto entra via textContent —
// nada de innerHTML nem markdown. Quem decide o estado é o main; aqui só se desenha.
import type {
  BridgeEvent, BridgeState, FolderPick, HistoryEntry, PanelResult, PendingPermission, ProviderDescriptor,
  SessionSnapshot,
} from '@tera/agent-bridge/contract';

const api = window.teracotaPanel!;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const providerSel = $<HTMLSelectElement>('provider');
const reasonEl = $('provider-reason');
const folderEl = $('folder');
const sessionsBox = $('sessions');
const sessionSel = $<HTMLSelectElement>('session-select');
const startBtn = $<HTMLButtonElement>('start');
const pickBtn = $<HTMLButtonElement>('pick');
const setupEl = $('setup');
const statusbar = $('statusbar');
const dot = $('dot');
const statusText = $('status-text');
const errorEl = $('error');
const historyEl = $('history');
const permEl = $('permission');
const composer = $('composer');
const promptEl = $<HTMLTextAreaElement>('prompt');
const sendBtn = $<HTMLButtonElement>('send');
const stopBtn = $<HTMLButtonElement>('stop');
const collapseOnly = $('collapse-only');
const simBanner = $('sim-banner');

const STATUS: Record<BridgeState, { text: string; kind: 'idle' | 'busy' | 'done' | 'error' }> = {
  starting: { text: 'Iniciando…', kind: 'busy' },
  idle: { text: 'Pronto', kind: 'idle' },
  running: { text: 'Processando…', kind: 'busy' },
  'waiting-permission': { text: 'Aguardando sua permissão', kind: 'busy' },
  done: { text: 'Concluído', kind: 'done' },
  error: { text: 'Erro', kind: 'error' },
  cancelled: { text: 'Interrompido', kind: 'idle' },
  closed: { text: 'Encerrada', kind: 'idle' },
};
const SENDABLE = new Set<BridgeState>(['idle', 'done', 'error', 'cancelled']);

let providers: ProviderDescriptor[] = [];
let picked: FolderPick | null = null;
let session: SessionSnapshot | null = null;
let permissions: PendingPermission[] = [];
const emptyEl = document.createElement('div');
emptyEl.className = 'empty';
emptyEl.textContent = 'Escolha um agente e uma pasta para começar.';

let partialEl: HTMLElement | null = null;

/** Resultado do IPC: erro vira faixa de erro */
function unwrap<T>(r: PanelResult<T>): T | undefined {
  if (r.ok) return r.data;
  showError(r.error);
  return undefined;
}

function showError(text: string | null): void {
  errorEl.hidden = !text;
  errorEl.textContent = text ?? '';
}

// ---------- histórico ----------

function addMessage(role: HistoryEntry['role'], text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  emptyEl.remove();
  historyEl.append(el);
  historyEl.scrollTop = historyEl.scrollHeight;
  return el;
}

function renderHistory(s: SessionSnapshot): void {
  historyEl.replaceChildren();
  partialEl = null;
  for (const h of s.history) addMessage(h.role, h.text);
  if (s.partial) partialEl = addMessage('assistant', s.partial);
}

// ---------- tela ----------

/** Faixa fixa quando o provider (da sessão ativa ou do selecionado) é a simulação */
function updateSimBanner(): void {
  const id = session ? session.providerId : providerSel.value;
  simBanner.hidden = !providers.find((p) => p.id === id)?.simulated;
}

function render(): void {
  updateSimBanner();
  const active = session !== null;
  setupEl.hidden = active;
  statusbar.hidden = !active;
  composer.hidden = !active;
  collapseOnly.hidden = active;
  if (!active) {
    historyEl.replaceChildren(emptyEl);
    partialEl = null;
    permEl.hidden = true;
    showError(null);
    statusText.textContent = '';
    delete dot.dataset.kind;
    return;
  }
  const st = STATUS[session!.state];
  dot.dataset.kind = st.kind;
  statusText.textContent = `${st.text} — ${session!.cwdLabel}${session!.model ? ` · ${session!.model}` : ''}`;
  const sendable = SENDABLE.has(session!.state);
  sendBtn.disabled = !sendable;
  promptEl.disabled = !sendable;
  stopBtn.hidden = !(session!.state === 'running' || session!.state === 'waiting-permission');
  renderPermission();
}

function renderPermission(): void {
  const p = permissions[0];
  permEl.hidden = !p;
  if (!p) return;
  $('perm-tool').textContent = p.toolName;
  $('perm-detail').textContent = p.detail;
  $('perm-warn').hidden = !p.outsideCwd;
  historyEl.scrollTop = historyEl.scrollHeight;
}

function renderSetup(): void {
  const previous = providerSel.value;
  providerSel.replaceChildren();
  for (const p of providers) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.available ? p.displayName : `${p.displayName} (indisponível)`;
    providerSel.append(o);
  }
  // mantém a escolha do usuário; no início, nunca pré-seleciona a simulação se houver outro agente disponível
  const preferred = providers.find((p) => p.id === previous)
    ?? providers.find((p) => p.available && !p.simulated) ?? providers.find((p) => p.available) ?? providers[0];
  if (preferred) providerSel.value = preferred.id;
  updateProviderNote();
}

function currentProvider(): ProviderDescriptor | undefined {
  return providers.find((p) => p.id === providerSel.value);
}

function updateProviderNote(): void {
  updateSimBanner();
  const p = currentProvider();
  reasonEl.hidden = !p || p.available;
  reasonEl.textContent = p && !p.available ? (p.reason ?? 'Indisponível.') : '';
  pickBtn.disabled = !p?.available;
}

function renderSessions(): void {
  sessionsBox.hidden = !picked;
  folderEl.hidden = !picked;
  if (!picked) return;
  folderEl.textContent = `Pasta: ${picked.cwdLabel}`;
  sessionSel.replaceChildren();
  const fresh = document.createElement('option');
  fresh.value = '';
  fresh.textContent = 'Nova sessão';
  sessionSel.append(fresh);
  for (const s of picked.sessions) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${new Date(s.lastModified).toLocaleString()} — ${s.title}`;
    sessionSel.append(o);
  }
}

// ---------- ações ----------

async function hydrate(): Promise<void> {
  const list = unwrap(await api.snapshot()) ?? [];
  session = list[list.length - 1] ?? null;
  permissions = session ? [...session.permissions] : [];
  if (session) renderHistory(session);
  render();
}

async function refreshProviders(): Promise<void> {
  providers = unwrap(await api.listProviders()) ?? [];
  renderSetup();
}

pickBtn.addEventListener('click', async () => {
  showError(null);
  const r = unwrap(await api.pickFolder(providerSel.value));
  if (r) {
    picked = r;
    renderSessions();
  }
});

providerSel.addEventListener('change', updateProviderNote);

startBtn.addEventListener('click', async () => {
  showError(null);
  startBtn.disabled = true;
  try {
    const r = unwrap(await api.startSession(providerSel.value, sessionSel.value || undefined));
    if (r) await hydrate();
  } finally {
    startBtn.disabled = false;
  }
});

async function sendPrompt(): Promise<void> {
  if (!session || !SENDABLE.has(session.state)) return;
  const text = promptEl.value.trim();
  if (!text) return;
  showError(null);
  promptEl.value = '';
  const r = await api.send(session.handle, text);
  if (!r.ok) {
    promptEl.value = text;
    showError(r.error);
  }
}

sendBtn.addEventListener('click', () => void sendPrompt());
promptEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void sendPrompt();
  }
});
stopBtn.addEventListener('click', async () => {
  if (session) unwrap(await api.interrupt(session.handle));
});
$('end').addEventListener('click', async () => {
  if (session) unwrap(await api.closeSession(session.handle));
});
for (const id of ['collapse', 'collapse2']) $(id).addEventListener('click', () => void api.hide());

async function answer(allow: boolean): Promise<void> {
  const p = permissions[0];
  if (!session || !p) return;
  unwrap(await api.respondPermission(session.handle, p.id, allow));
}
$('allow').addEventListener('click', () => void answer(true));
$('deny').addEventListener('click', () => void answer(false));

// ---------- eventos do main ----------

function onEvent(e: BridgeEvent): void {
  if (!session || e.handle !== session.handle) return;
  switch (e.type) {
    case 'state':
      if (e.state === 'closed') {
        session = null;
        permissions = [];
        picked = null;
        renderSessions();
      } else {
        session.state = e.state;
      }
      break;
    case 'session':
      session.model = e.model;
      break;
    case 'text-delta':
      partialEl ??= addMessage('assistant', '');
      partialEl.textContent = (partialEl.textContent ?? '') + e.text;
      historyEl.scrollTop = historyEl.scrollHeight;
      break;
    case 'message':
      if (e.role === 'assistant') {
        partialEl?.remove();
        partialEl = null;
      }
      addMessage(e.role, e.text);
      break;
    case 'tool':
      addMessage('tool', e.summary ? `${e.name}: ${e.summary}` : e.name);
      break;
    case 'permission-request':
      permissions.push({ id: e.id, toolName: e.toolName, detail: e.detail, outsideCwd: e.outsideCwd });
      break;
    case 'permission-resolved':
      permissions = permissions.filter((p) => p.id !== e.id);
      break;
    case 'turn-end':
      partialEl = null;
      permissions = [];
      if (e.outcome === 'error') {
        showError(e.message ?? 'Erro no agente.');
        addMessage('system', e.message ?? 'Erro no agente.');
      }
      break;
  }
  render();
}

api.onEvent(onEvent);
window.addEventListener('focus', () => { if (!session) void refreshProviders(); });
void (async () => {
  await refreshProviders();
  await hydrate();
})();
