// Janela de tarefas da Tera Pocket. Todo texto dinâmico entra por textContent (nada de innerHTML).
import type { TaskView } from '../shared/pocket';
import type { PocketEvidence, PocketResult } from '../shared/pocket-ipc';
import { actionsFor, CLASS_LABEL, defaultResumePrompt, secondsLeft, STATE_LABEL } from '../shared/pocket-ui';

const api = window.pocket;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

const add = (el: HTMLElement, ...kids: Child[]): void => { for (const k of kids) if (k) el.append(k); };

let tasks: TaskView[] = [];
let selected: string | null = null;
let creating = false;
let evidence: PocketEvidence | null = null;
let evidenceFor: string | null = null;
const acked = new Set<string>();
const drafts = new Map<string, string>(); // texto digitado por tarefa (sobrevive a re-render)

async function call<T>(p: Promise<PocketResult<T>>, errEl?: HTMLElement): Promise<T | undefined> {
  const r = await p;
  if (r.ok) { if (errEl) errEl.textContent = ''; return r.data; }
  if (errEl) errEl.textContent = r.message;
  else showBanner(r.message, true);
  return undefined;
}

function showBanner(msg: string | null, bad = false): void {
  const b = $('banner');
  b.hidden = !msg;
  b.textContent = msg ?? '';
  b.className = bad ? 'bad' : '';
}

async function refresh(): Promise<void> {
  const list = await call(api!.list());
  if (list) tasks = list;
  render();
}

function renderList(): void {
  const ul = $('list');
  ul.replaceChildren();
  $('empty').hidden = tasks.length > 0;
  for (const t of [...tasks].reverse()) {
    ul.append(h('li', { class: t.id === selected ? 'sel' : '', onclick: () => { selected = t.id; creating = false; evidence = null; void render(); } },
      h('div', { class: 't' }, t.title),
      h('div', {}, h('span', { class: `badge ${t.state}` }, STATE_LABEL[t.state]), t.pendingApprovals.length ? h('span', { class: 'chip' }, ` ${t.pendingApprovals.length} aprovação(ões)`) : null)));
  }
}

function newTaskForm(): HTMLElement {
  const err = h('div', { class: 'err' });
  const title = h('input', { placeholder: 'Ex.: corrigir o teste que falha' });
  const prompt = h('textarea', { placeholder: 'O que a Tera deve fazer?' });
  const cwd = h('input', { placeholder: 'C:\\caminho\\do\\projeto', readonly: true });
  return h('div', {},
    h('h2', {}, 'Nova tarefa'),
    h('p', { class: 'muted' }, 'A tarefa fica na fila. Nada roda até você clicar em "Iniciar".'),
    h('label', {}, 'Título'), title, h('label', {}, 'Instruções'), prompt, h('label', {}, 'Pasta de trabalho (o agente escreve livremente só dentro dela)'),
    h('div', { class: 'row' }, cwd, h('button', { onclick: async () => { const p = await call(api!.pickFolder(), err); if (p) cwd.value = p; } }, 'Escolher…')),
    err,
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: async () => {
        const t = await call(api!.create({ title: title.value, prompt: prompt.value, cwd: cwd.value }), err);
        if (t) { creating = false; selected = t.id; await refresh(); }
      } }, 'Criar na fila'),
      h('button', { onclick: () => { creating = false; render(); } }, 'Voltar')));
}

function approvalCards(t: TaskView): HTMLElement[] {
  return t.pendingApprovals.map((a) => {
    const left = h('span', { class: 'muted' }, `expira em ${secondsLeft(a.expiresAt, Date.now())} s`);
    left.dataset.expires = String(a.expiresAt);
    const err = h('div', { class: 'err' });
    return h('div', { class: 'card danger' },
      h('div', {}, h('strong', {}, 'Pedido de aprovação'), ' ', h('span', { class: 'chip' }, CLASS_LABEL[a.classification] ?? a.classification)),
      h('div', {}, a.summary), left, err,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: async () => { await call(api!.approval(a.approvalRequestId, 'allow'), err); await refresh(); } }, 'Aprovar esta ação (uma vez)'),
        h('button', { class: 'danger', onclick: async () => { await call(api!.approval(a.approvalRequestId, 'deny'), err); await refresh(); } }, 'Negar')));
  });
}

async function loadEvidence(taskId: string, withGit = false): Promise<void> {
  evidence = (await call(withGit ? api!.evidenceGit(taskId) : api!.evidence(taskId))) ?? null;
  evidenceFor = taskId;
  render();
}

function evidencePanel(t: TaskView): HTMLElement {
  const err = h('div', { class: 'err' });
  const box = h('div', { class: 'card' }, h('strong', {}, 'Reconciliação'),
    h('p', { class: 'muted' }, 'O Teracota não repete nada sozinho depois de uma falha. Revise o que pode ter acontecido e decida.'));
  if (evidenceFor !== t.id || !evidence) {
    box.append(h('button', { onclick: () => void loadEvidence(t.id) }, 'Ver evidência'));
    return box;
  }
  const ev = evidence;
  box.append(h('pre', {}, `Motivo: ${ev.reason ?? '—'}`));
  if (ev.transcript) box.append(h('pre', {}, `Transcrito: ${ev.transcript.bytes} bytes; últimos eventos: ${ev.transcript.tail.join(' → ') || '—'}${ev.transcript.incompleteTurn ? '\n⚠ turno incompleto (termina sem resposta do assistente)' : ''}`));
  else box.append(h('pre', {}, 'Transcrito: não encontrado'));
  if (ev.externalActivity) box.append(h('pre', {}, '⚠ O transcrito foi alterado fora do Teracota (ex.: claude --resume num terminal).'));
  if (!ev.git) box.append(h('div', { class: 'row' }, h('button', { onclick: () => void loadEvidence(t.id, true) }, 'Verificar alterações com git'), h('span', { class: 'muted' }, 'executa o git no repositório da tarefa (que o agente pode ter alterado)')));
  if (ev.git) box.append(h('pre', {}, `Git: ${ev.git.changedFiles} arquivo(s) alterado(s)${ev.git.files.length ? `\n${ev.git.files.join('\n')}` : ''}${ev.git.truncated ? '\n…' : ''}`));
  for (const e of ev.effects) {
    const sel = h('select', {},
      h('option', { value: '' }, e.status === 'unconfirmed' ? 'decida…' : `decidido: ${e.status.replace('user_', '')}`),
      h('option', { value: 'applied' }, 'já foi aplicado'), h('option', { value: 'not_applied' }, 'não foi aplicado'), h('option', { value: 'unknown' }, 'não sei'));
    sel.disabled = e.status !== 'unconfirmed';
    sel.addEventListener('change', async () => { if (sel.value) { await call(api!.resolveEffect(e.id, sel.value as 'applied'), err); await loadEvidence(t.id); } });
    box.append(h('div', { class: 'row' }, h('span', { class: 'chip' }, e.toolName), h('span', {}, e.summary),
      h('span', { class: 'muted' }, `sugestão: ${e.suggestion === 'applied' ? 'aplicado' : e.suggestion === 'not_applied' ? 'não aplicado' : 'desconhecido'}${e.verifiable ? '' : ' (não verificável)'}`), sel));
  }
  const open = ev.effects.filter((e) => e.status === 'unconfirmed').length;
  const ackBtn = h('button', { onclick: async () => { if (await call(api!.ack(t.id), err) !== undefined) { acked.add(t.id); await refresh(); } } }, 'Revisei a evidência');
  ackBtn.disabled = open > 0 || acked.has(t.id);
  box.append(err, h('div', { class: 'row' }, ackBtn, acked.has(t.id) ? h('span', { class: 'muted' }, '✓ reconhecido') : null));
  return box;
}

function renderDetail(): void {
  const d = $('detail');
  d.replaceChildren();
  if (creating) { d.append(newTaskForm()); return; }
  const t = tasks.find((x) => x.id === selected);
  if (!t) { d.append(h('p', { class: 'muted' }, 'Selecione uma tarefa ou crie uma nova.')); return; }
  const a = actionsFor({ ...t, reconcileAcked: acked.has(t.id) });
  const err = h('div', { class: 'err' });
  const run = (fn: () => Promise<PocketResult<unknown>>) => async () => { await call(fn(), err); await refresh(); };

  add(d, h('h2', {}, t.title), h('div', {}, h('span', { class: `badge ${t.state}` }, STATE_LABEL[t.state]), h('span', { class: 'muted' }, `  ${t.cwd}`)),
    t.retryCount > 0 && t.state === 'running' ? h('p', { class: 'muted' }, `Tentando de novo (${t.retryCount}/3) após erro transitório…`) : null,
    h('h3', {}, 'Instruções'), h('pre', {}, t.prompt));
  if (a.approvals) d.append(h('h3', {}, 'Aprovações'), ...approvalCards(t));
  if (a.reconcile) d.append(evidencePanel(t));
  if (t.state === 'review') d.append(h('p', { class: 'muted' }, 'A execução terminou com sucesso, mas a tarefa só vira "Concluída" quando você aprovar.'));
  if (t.state === 'auth_error') d.append(h('p', { class: 'muted' }, 'O Claude Code não está autenticado. Faça login no `claude` oficial num terminal e depois retome. O Teracota não pede nem guarda credenciais.'));
  if (t.state === 'usage_limited') d.append(h('p', { class: 'muted' }, 'Limite de uso atingido. Retome quando quiser; nada volta sozinho.'));
  if (t.state === 'session_expired') d.append(h('p', { class: 'muted' }, 'A sessão anterior não existe mais. Iniciar uma nova perde o contexto.'));

  const row = h('div', { class: 'row' });
  if (a.start) row.append(h('button', { class: 'primary', onclick: run(() => api!.start(t.id)) }, 'Iniciar'));
  if (a.interrupt) row.append(h('button', { onclick: run(() => api!.interrupt(t.id)) }, 'Interromper'));
  if (a.approveReview) row.append(h('button', { class: 'primary', onclick: run(() => api!.approveReview(t.id)) }, 'Aprovar e concluir'));
  if (a.acceptAsIs) row.append(h('button', { onclick: run(() => api!.acceptAsIs(t.id)) }, t.state === 'needs_reconcile' ? 'Aceitar como está (revisão)' : 'O que foi feito basta (revisão)'));
  if (a.markFailed) row.append(h('button', { class: 'danger', onclick: run(() => api!.resolveReconcile(t.id, 'failed')) }, 'Marcar como falha'));
  if (a.cancel) row.append(h('button', { class: 'danger', onclick: run(() => api!.cancel(t.id)) }, 'Cancelar'));
  d.append(row);

  if (a.resume) {
    const ta = h('textarea', {});
    ta.value = drafts.get(t.id) ?? defaultResumePrompt(t.state);
    ta.addEventListener('input', () => drafts.set(t.id, ta.value));
    const btn = h('button', { class: 'primary', onclick: run(() => api!.resume({ taskId: t.id, prompt: ta.value, newSession: a.newSession })) },
      a.newSession ? 'Iniciar nova sessão (perde o contexto)' : t.state === 'review' ? 'Pedir ajuste' : 'Retomar');
    btn.disabled = a.resumeBlockedReason !== null;
    d.append(h('h3', {}, t.state === 'review' ? 'Pedir ajuste' : 'Retomar com este prompt (editável)'), ta,
      h('div', { class: 'row' }, btn, a.resumeBlockedReason ? h('span', { class: 'muted' }, `⛔ ${a.resumeBlockedReason}`) : null));
  }
  d.append(err);
}

function render(): void {
  renderList();
  renderDetail();
}

async function init(): Promise<void> {
  if (!api) { showBanner('API da Tera Pocket indisponível.', true); return; }
  $('new-btn').addEventListener('click', () => { creating = true; selected = null; render(); });
  const st = await call(api.status());
  if (st) {
    $('status').textContent = st.ready ? (st.claudeFound ? 'Claude Code encontrado' : 'Claude Code não encontrado') : '';
    if (st.blocked) showBanner(st.blocked, true);
    else if (!st.claudeFound) showBanner('Não encontrei o `claude` no PATH. Instale o Claude Code oficial para executar tarefas.');
    else if (st.orphansKilled > 0) showBanner(`${st.orphansKilled} processo(s) órfão(s) de uma execução anterior foram encerrados.`);
  }
  api.onChanged((list) => { tasks = list; render(); });
  await refresh();
  setInterval(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-expires]')) {
      el.textContent = `expira em ${secondsLeft(Number(el.dataset.expires), Date.now())} s`;
    }
  }, 1000);
}

void init();
