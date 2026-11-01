// "Agora", "Sessões" e o pedido sozinho (peek): os cartões das sessões dos agentes.
// Tudo por textContent. Os pedidos mostram o que a IA quer; a resposta é no terminal dela.
import type { AppPanelApi } from '../shared/app-panel';
import type { AiBadge, LiveSession, LiveSnapshot } from '../shared/live';
import type { PluginCard } from '../shared/plugins';
import { ago, sessionLine, sortSessions } from './panel-format';

type Filter = 'all' | 'active' | 'waiting';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function aiIcon(b: AiBadge, small = false): HTMLElement {
  const i = el('span', small ? 'ai-icon small' : 'ai-icon', b.text);
  i.style.setProperty('--ai', b.color);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** Um cartão de sessão; com pedido, mostra o pedido inteiro */
export function sessionCard(s: LiveSession, opts: { showAgent: boolean; now?: number }): HTMLElement {
  const line = sessionLine(s);
  const card = el('article', `card glass hit${s.request ? ' request' : ''}${s.endedAt !== undefined ? ' ended' : ''}`);
  card.dataset.testid = 'session-card';
  const head = el('div', 's-head');
  const dot = el('span', 's-dot');
  dot.dataset.kind = line.dot;
  head.append(dot, el('span', 's-name', s.project));
  if (opts.showAgent) {
    const agent = el('span', 's-agent');
    agent.append(aiIcon(s.badge, true), s.providerName);
    head.append(agent);
  }
  head.append(el('span', 's-when', ago(s.endedAt ?? s.request?.at ?? s.lastSeen, opts.now)));
  card.append(head);

  if (s.request) {
    card.append(el('div', 'req-msg', s.request.message));
    if (s.request.detail) card.append(el('code', 'req-detail', s.request.detail));
    if (s.request.options?.length) {
      const list = el('div', 'options');
      s.request.options.forEach((o, i) => {
        const row = el('div', 'option');
        row.append(el('span', 'n', String(i + 1)), o);
        list.append(row);
      });
      card.append(list);
    }
    card.append(el('div', 'hint', `Responda no terminal de ${s.project}.`));
    return card;
  }
  const text = el('div', 's-line', line.label);
  if (line.detail) {
    text.append(' · ');
    text.append(el('span', 'mono', line.detail));
  }
  card.append(text);
  return card;
}

/** Cartão de um plugin (Pomodoro, CI...) */
export function pluginCard(c: PluginCard): HTMLElement {
  const card = el('article', `card glass hit plugin-card${c.level === 'attention' ? ' request' : ''}`);
  card.dataset.level = c.level;
  card.dataset.testid = 'plugin-card';
  const head = el('div', 's-head');
  const agent = el('span', 's-agent');
  agent.append(aiIcon(c.badge, true), c.pluginName);
  head.append(el('span', 's-name', c.title), agent);
  card.append(head);
  if (c.line) card.append(el('div', 's-line', c.line));
  if (c.progress !== undefined) {
    const bar = el('div', 'bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(Math.round(c.progress * 100)));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = el('span');
    fill.style.width = `${Math.round(c.progress * 100)}%`;
    bar.append(fill);
    card.append(bar);
  }
  return card;
}

export interface LiveView {
  render(snapshot: LiveSnapshot): void;
  /** Quantos pedidos em aberto */
  waitingCount(): number;
}

export function mountLive(opts: {
  api: AppPanelApi;
  /** Mudou o tamanho do conteúdo */
  changed(): void;
}): LiveView {
  const $ = (id: string) => document.getElementById(id)!;
  const root = $('root');
  const nowList = $('now-list');
  const nowEmpty = $('now-empty');
  const subtitle = $('subtitle');
  const badge = $('badge');
  const sessList = $('sess-list');
  const endedTitle = $('sess-ended-title');
  const endedList = $('sess-ended');
  const peek = $('peek');
  let snapshot: LiveSnapshot = { active: [], ended: [] };
  let filter: Filter = 'all';
  let peekIndex = 0;

  for (const b of document.querySelectorAll<HTMLButtonElement>('#sess-filter button')) {
    b.onclick = () => {
      filter = b.dataset.filter as Filter;
      for (const o of document.querySelectorAll<HTMLButtonElement>('#sess-filter button')) o.setAttribute('aria-selected', String(o === b));
      render(snapshot);
    };
  }

  function renderPeek(waiting: LiveSession[]): void {
    if (!waiting.length) {
      peek.replaceChildren();
      return;
    }
    peekIndex = Math.min(peekIndex, waiting.length - 1);
    const s = waiting[peekIndex]!;
    const card = sessionCard(s, { showAgent: true });
    card.querySelector('.hint')?.remove();
    if (waiting.length > 1) {
      const next = el('button', 'peek-count', `${peekIndex + 1} de ${waiting.length} ›`);
      next.type = 'button';
      next.setAttribute('aria-label', 'Próximo pedido');
      next.onclick = () => {
        peekIndex = (peekIndex + 1) % waiting.length;
        render(snapshot);
      };
      card.querySelector('.s-when')?.replaceWith(next);
    }
    const actions = el('div', 'peek-actions');
    const buttons = el('div', 'row');
    const open = el('button', 'primary', 'Abrir a Tera');
    open.type = 'button';
    open.dataset.testid = 'peek-open';
    open.onclick = () => void opts.api.expand();
    const later = el('button', 'ghost', 'Depois');
    later.type = 'button';
    later.dataset.testid = 'peek-later';
    later.onclick = () => void window.teracotaPanel?.hide();
    buttons.append(later, open);
    actions.append(el('span', 'hint', `Responda no terminal de ${s.project}.`), buttons);
    card.append(actions);
    peek.replaceChildren(card);
  }

  function render(next: LiveSnapshot): void {
    snapshot = next;
    const now = Date.now();
    const active = sortSessions(next.active);
    const waiting = active.filter((s) => s.request);
    const showAgent = new Set(active.map((s) => s.provider)).size > 1;

    root.dataset.waiting = String(waiting.length > 0);
    subtitle.textContent = waiting.length
      ? `· ${waiting.length} esperando`
      : active.length ? `· ${active.length} ${active.length === 1 ? 'sessão' : 'sessões'}` : '';
    badge.hidden = waiting.length === 0;
    badge.textContent = String(waiting.length);

    const cards = next.cards ?? [];
    nowList.replaceChildren(...active.map((s) => sessionCard(s, { showAgent, now })), ...cards.map(pluginCard));
    nowEmpty.hidden = active.length + cards.length > 0;

    const shown = filter === 'waiting' ? waiting : filter === 'active' ? active.filter((s) => s.working || s.request) : active;
    sessList.replaceChildren(...shown.map((s) => sessionCard(s, { showAgent: true, now })));
    if (!shown.length) {
      const empty = el('div', 'card glass hit empty', filter === 'waiting' ? 'Nenhuma IA esperando você.' : 'Nenhuma sessão aberta.');
      sessList.append(empty);
    }
    endedTitle.hidden = next.ended.length === 0 || filter === 'waiting';
    endedList.hidden = endedTitle.hidden;
    endedList.replaceChildren(...next.ended.map((s) => sessionCard(s, { showAgent: true, now })));

    renderPeek(waiting);
    opts.changed();
  }

  // o "há 3 min" anda sozinho
  setInterval(() => render(snapshot), 30_000);

  return {
    render,
    waitingCount: () => snapshot.active.filter((s) => s.request).length,
  };
}
