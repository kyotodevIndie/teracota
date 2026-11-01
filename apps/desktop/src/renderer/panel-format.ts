// Textos e ordem da interface ("agora", sessões, limites). Funções puras, testadas.
import type { ActivityKind, LiveSession, ProviderUsage, UsageWindow } from '../shared/live';

/** "agora", "3 min", "2 h", "ontem", "3 dias" */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `${d} dias`;
}

const ACTIVITY: Record<ActivityKind, string> = {
  reading: 'Lendo',
  searching: 'Procurando',
  typing: 'Editando',
  terminal: 'Rodando comando',
  web: 'Na web',
  delegating: 'Delegando',
  thinking: 'Pensando',
  listening: 'Lendo seu pedido',
  idle: 'Parada',
};

export type DotKind = 'waiting' | 'working' | 'thinking' | 'idle';

/** Estado da sessão em uma linha: o que mostrar e a cor da bolinha */
export function sessionLine(s: LiveSession): { label: string; detail?: string; dot: DotKind } {
  if (s.request) {
    const label = s.request.kind === 'permission' ? 'Esperando você' : s.request.kind === 'question' ? 'Tem uma pergunta' : 'Esperando você';
    return { label, detail: s.request.detail, dot: 'waiting' };
  }
  if (s.endedAt !== undefined) return { label: 'Encerrada', dot: 'idle' };
  if (!s.working) return { label: 'Parada', dot: 'idle' };
  const kind = s.activity?.kind ?? 'thinking';
  return { label: ACTIVITY[kind], detail: s.activity?.detail, dot: kind === 'thinking' || kind === 'listening' ? 'thinking' : 'working' };
}

/** Pedidos primeiro (o mais antigo no topo, como fila), depois quem trabalha, depois o resto */
export function sortSessions(list: LiveSession[]): LiveSession[] {
  const rank = (s: LiveSession) => (s.request ? 0 : s.working ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b)
    || (a.request && b.request ? a.request.at - b.request.at : b.lastSeen - a.lastSeen));
}

export const WINDOW_LABEL: Record<UsageWindow['id'], string> = {
  five_hour: 'Limite de 5 horas',
  seven_day: 'Semanal',
  spend_limit: 'Gasto do período',
};

/** A partir de quanto o limite fica âmbar */
export const WARN_PCT = 80;

export const usageLevel = (pct: number) => (pct >= WARN_PCT ? 'warn' : 'ok');

/** Porcentagem do chip: a janela mais apertada daquela IA */
export function chipPct(u: ProviderUsage): number {
  return Math.max(...u.windows.map((w) => w.usedPct));
}

const WEEKDAYS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
const two = (n: number) => String(n).padStart(2, '0');

/** "Redefine às 14:10" (hoje) ou "Reinicia sex., 03:00" */
export function resetText(at: number | null, now = Date.now()): string {
  if (at === null) return '';
  const d = new Date(at);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? `Redefine às ${time}` : `Reinicia ${WEEKDAYS[d.getDay()]}, ${time}`;
}

