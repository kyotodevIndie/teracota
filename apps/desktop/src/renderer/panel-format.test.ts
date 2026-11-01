import { describe, expect, it } from 'vitest';
import type { LiveSession } from '../shared/live';
import { ago, chipPct, resetText, sessionLine, sortSessions, usageLevel } from './panel-format';

const s = (o: Partial<LiveSession>): LiveSession => ({
  key: 'k', provider: 'agente', providerName: 'Agente', badge: { text: 'A', color: '#000' }, project: 'p', working: false,
  activity: null, request: null, startedAt: 0, lastSeen: 0, ...o,
});

describe('textos da interface', () => {
  it('há quanto tempo', () => {
    const now = 1_000_000_000;
    expect(ago(now - 10_000, now)).toBe('agora');
    expect(ago(now - 3 * 60_000, now)).toBe('3 min');
    expect(ago(now - 2 * 3600_000, now)).toBe('2 h');
    expect(ago(now - 26 * 3600_000, now)).toBe('ontem');
  });

  it('linha da sessão: pedido, trabalhando, parada', () => {
    expect(sessionLine(s({ request: { kind: 'permission', message: 'm', detail: 'npm test', at: 1 } }))).toEqual({ label: 'Esperando você', detail: 'npm test', dot: 'waiting' });
    expect(sessionLine(s({ working: true, activity: { kind: 'typing', detail: 'app.ts' } }))).toEqual({ label: 'Editando', detail: 'app.ts', dot: 'working' });
    expect(sessionLine(s({ working: true })).dot).toBe('thinking');
    expect(sessionLine(s({})).label).toBe('Parada');
  });

  it('ordem: pedidos (mais antigo primeiro), quem trabalha, o resto', () => {
    const list = [
      s({ key: 'parada', lastSeen: 9 }),
      s({ key: 'pedido-novo', request: { kind: 'question', message: '', at: 5 } }),
      s({ key: 'trabalhando', working: true, lastSeen: 1 }),
      s({ key: 'pedido-velho', request: { kind: 'permission', message: '', at: 2 } }),
    ];
    expect(sortSessions(list).map((x) => x.key)).toEqual(['pedido-velho', 'pedido-novo', 'trabalhando', 'parada']);
  });

  it('chip: a janela mais apertada; âmbar a partir de 80%', () => {
    expect(chipPct({ provider: 'x', displayName: 'x', badge: { text: 'x', color: '#000' }, updatedAt: 0, windows: [{ id: 'five_hour', usedPct: 30, resetsAt: null }, { id: 'seven_day', usedPct: 85, resetsAt: null }] })).toBe(85);
    expect(usageLevel(79)).toBe('ok');
    expect(usageLevel(80)).toBe('warn');
  });

  it('quando reinicia: hoje mostra a hora; outro dia, o dia', () => {
    const now = new Date(2026, 10, 1, 9, 0).getTime();
    expect(resetText(new Date(2026, 10, 1, 14, 10).getTime(), now)).toBe('Redefine às 14:10');
    expect(resetText(new Date(2026, 10, 6, 3, 0).getTime(), now)).toBe('Reinicia sex., 03:00');
    expect(resetText(null, now)).toBe('');
  });
});
