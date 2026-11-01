// Tera no celular (rede de casa). Lê o QR do PC → pareia (o PC pergunta "conectar?") →
// acompanha as sessões, os pedidos das IAs e os limites. Tudo cifrado com a chave que veio
// no QR (shared/remote.ts); a chave fica só neste navegador. Nesta fase só acompanha.
import type { LiveSession } from '../shared/live';
import { type PairStatus, type RemoteSnapshot, b64url, fromB64url, newId, open, parsePairFragment, seal } from '../shared/remote';
import { WINDOW_LABEL, ago, resetText, sessionLine, sortSessions, usageLevel } from '../renderer/panel-format';

const STORE = 'tera-remote';
const POLL_MS = 2000;
const app = document.getElementById('app')!;
const statusEl = document.getElementById('status')!;

interface Creds {
  device: string;
  key: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function loadCreds(): Creds | null {
  try {
    const c = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Creds | null;
    return c && typeof c.device === 'string' && typeof c.key === 'string' ? c : null;
  } catch {
    return null;
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function screen(title: string, text: string, ...extra: Node[]): void {
  const box = el('div', 'center');
  box.append(el('strong', undefined, title), el('span', undefined, text), ...extra);
  app.replaceChildren(box);
}

// ---------- pareamento ----------

async function pair(pairId: string, key: Uint8Array): Promise<void> {
  const device = newId();
  const input = el('input');
  input.value = /iphone/i.test(navigator.userAgent) ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Celular Android' : 'Celular';
  input.setAttribute('aria-label', 'Nome deste celular');
  const go = el('button', undefined, 'Conectar');
  const form = el('div', 'card');
  form.append(el('span', 'line', 'Nome deste celular (aparece no PC):'), input, go);
  screen('Conectar à Tera', 'Este celular vai acompanhar as sessões do seu PC pela rede de casa.', form);
  await new Promise<void>((resolve) => { go.onclick = () => resolve(); });
  const name = input.value.trim().slice(0, 40) || 'Celular';
  screen('Confirme no PC', `A Tera está perguntando se pode conectar "${name}". Clique em Conectar lá.`);
  for (;;) {
    let status: PairStatus | null = null;
    try {
      const r = await post('/pair', { pair: pairId, device, box: seal(key, { name, at: Date.now() }) });
      status = r.status === 200 ? (open<{ status: PairStatus }>(key, r.data)?.status ?? null) : r.status === 404 ? 'expired' : null;
    } catch {
      status = null;
    }
    if (status === 'approved') {
      localStorage.setItem(STORE, JSON.stringify({ device, key: b64url(key) } satisfies Creds));
      history.replaceState(null, '', location.pathname);
      return;
    }
    if (status === 'denied') return screen('Não conectado', 'O PC recusou este celular.');
    if (status === 'expired') return screen('QR code vencido', 'Gere outro na Tera (Ajustes → Celular) e leia de novo.');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ---------- acompanhar ----------

function sessionCard(s: LiveSession): HTMLElement {
  const line = sessionLine(s);
  const card = el('article', s.request ? 'card request' : 'card');
  const head = el('div', 'head');
  const dot = el('span', 'dot-s');
  dot.dataset.kind = line.dot;
  const badge = el('span', 'badge', s.badge.text);
  badge.style.background = s.badge.color;
  const agent = el('span', 'agent');
  agent.append(badge, s.providerName);
  head.append(dot, el('span', 'name', s.project), agent, el('span', 'when', ago(s.request?.at ?? s.lastSeen)));
  card.append(head);
  if (s.request) {
    card.append(el('div', 'msg', s.request.message));
    if (s.request.detail) card.append(el('code', 'detail', s.request.detail));
    if (s.request.options?.length) {
      const list = el('ol', 'options');
      for (const o of s.request.options) list.append(el('li', undefined, o));
      card.append(list);
    }
    card.append(el('div', 'hint', `Responda no terminal de ${s.project}, no PC.`));
  } else {
    card.append(el('div', 'line', line.detail ? `${line.label} · ${line.detail}` : line.label));
  }
  return card;
}

let lastWaiting = 0;

function render(snap: RemoteSnapshot): void {
  document.getElementById('pc')!.textContent = `· ${snap.pcName}`;
  const active = sortSessions(snap.live.active);
  const waiting = active.filter((s) => s.request).length;
  document.body.classList.toggle('waiting', waiting > 0);
  document.title = waiting ? `(${waiting}) Tera` : 'Tera';
  // pedido novo: vibra (o navegador só deixa notificar de verdade com HTTPS)
  if (waiting > lastWaiting) navigator.vibrate?.([120, 80, 120]);
  lastWaiting = waiting;

  const out: Node[] = [];
  if (snap.usage.length) {
    const chips = el('div', 'chips');
    for (const u of snap.usage) {
      for (const w of u.windows) {
        const chip = el('div', usageLevel(w.usedPct) === 'warn' ? 'chip warn' : 'chip');
        chip.append(el('span', undefined, `${u.displayName} · ${WINDOW_LABEL[w.id]}: ${Math.round(w.usedPct)}%`));
        const bar = el('div', 'bar');
        const fill = el('span');
        fill.style.width = `${Math.min(100, w.usedPct)}%`;
        bar.append(fill);
        chip.append(bar, el('span', 'agent', resetText(w.resetsAt)));
        chips.append(chip);
      }
    }
    out.push(chips);
  }
  out.push(el('div', 'section', waiting ? `Agora · ${waiting} esperando você` : 'Agora'));
  if (active.length) out.push(...active.map(sessionCard));
  for (const c of snap.live.cards ?? []) {
    const card = el('article', 'card');
    const head = el('div', 'head');
    const badge = el('span', 'badge', c.badge.text);
    badge.style.background = c.badge.color;
    head.append(el('span', 'name', c.title), el('span', 'when', c.pluginName), badge);
    card.append(head);
    if (c.line) card.append(el('div', 'line', c.line));
    if (c.progress !== undefined) {
      const bar = el('div', 'bar-row');
      const fill = el('span');
      fill.style.width = `${Math.round(c.progress * 100)}%`;
      bar.append(fill);
      card.append(bar);
    }
    out.push(card);
  }
  if (!active.length && !(snap.live.cards ?? []).length) out.push(el('div', 'empty', 'Nenhuma sessão aberta no PC agora.'));
  if (snap.live.ended.length) {
    out.push(el('div', 'section', 'Encerradas'));
    out.push(...snap.live.ended.slice(0, 5).map(sessionCard));
  }
  app.replaceChildren(...out);
}

async function watch(creds: Creds): Promise<void> {
  const key = fromB64url(creds.key);
  if (!key) return forget();
  for (;;) {
    try {
      const r = await post('/api', { device: creds.device, box: seal(key, { op: 'snapshot', at: Date.now() }) });
      if (r.status === 401) return forget('Este celular foi desconectado no PC (ou o relógio está muito errado).');
      const snap = r.status === 200 ? open<RemoteSnapshot>(key, r.data) : null;
      if (snap) {
        statusEl.textContent = 'ao vivo';
        statusEl.classList.remove('off');
        render(snap);
      }
    } catch {
      statusEl.textContent = 'sem conexão com o PC';
      statusEl.classList.add('off');
    }
    await new Promise((res) => setTimeout(res, document.hidden ? POLL_MS * 3 : POLL_MS));
  }
}

function forget(reason = 'Leia o QR code de novo na Tera (Ajustes → Celular).'): void {
  localStorage.removeItem(STORE);
  screen('Desconectado', reason);
}

void (async () => {
  const fragment = parsePairFragment(location.hash);
  if (fragment) await pair(fragment.pairId, fragment.key);
  const creds = loadCreds();
  if (creds) await watch(creds);
  else if (!fragment) screen('Tera', 'Na Tera do PC, abra Ajustes → Celular → Conectar celular, e leia o QR code com a câmera.');
})();
