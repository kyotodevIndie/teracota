import { describe, expect, it } from 'vitest';
import { GROUP_WINDOW_MS, INFO_TTL_MS, MAX_ITEMS, NotificationQueue } from './notifications';

function queue() {
  let t = 1_000_000;
  const q = new NotificationQueue(() => t);
  return { q, advance: (ms: number) => { t += ms; } };
}

const perm = (message: string, sessionKey = 's1') => ({ kind: 'permission' as const, title: 'P', message, sessionKey });

describe('NotificationQueue', () => {
  it('solicitações ficam até serem resolvidas, mesmo com o tempo passando', () => {
    const { q, advance } = queue();
    const { item } = q.push(perm('rodar npm test'));
    advance(60 * 60 * 1000);
    q.prune();
    expect(q.pending().map((n) => n.id)).toEqual([item.id]);
    expect(q.resolve(item.id)).toBe(true);
    expect(q.pending()).toEqual([]);
  });

  it('informativas expiram sozinhas', () => {
    const { q, advance } = queue();
    q.push({ kind: 'completion', title: 'C', message: 'pronto' });
    expect(q.active()).toHaveLength(1);
    advance(INFO_TTL_MS.completion + 1);
    expect(q.active()).toHaveLength(0);
  });

  it('uma notificação nova não tira a solicitação pendente do topo', () => {
    const { q } = queue();
    const { item } = q.push(perm('editar arquivo'));
    q.push({ kind: 'error', title: 'E', message: 'falhou' });
    q.push({ kind: 'completion', title: 'C', message: 'pronto' });
    expect(q.active()[0]!.id).toBe(item.id);
  });

  it('várias solicitações: todas preservadas, a mais antiga primeiro', () => {
    const { q, advance } = queue();
    const a = q.push(perm('a', 's1')).item;
    advance(10);
    const b = q.push(perm('b', 's2')).item;
    advance(10);
    const c = q.push({ kind: 'question', title: 'Q', message: 'c', sessionKey: 's3' }).item;
    expect(q.pending().map((n) => n.id)).toEqual([a.id, b.id, c.id]);
  });

  it('agrupa eventos repetidos e conta', () => {
    const { q, advance } = queue();
    const first = q.push({ kind: 'error', title: 'E', message: 'igual', sessionKey: 's1' });
    const second = q.push({ kind: 'error', title: 'E', message: 'igual', sessionKey: 's1' });
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.item.count).toBe(2);
    // depois da janela de agrupamento, vira outra
    advance(GROUP_WINDOW_MS + 1);
    expect(q.push({ kind: 'error', title: 'E', message: 'igual', sessionKey: 's1' }).isNew).toBe(true);
  });

  it('não confunde sessões diferentes', () => {
    const { q } = queue();
    q.push(perm('mesmo texto', 's1'));
    q.push(perm('mesmo texto', 's2'));
    expect(q.pending()).toHaveLength(2);
    expect(q.resolveSession('s1')).toBe(1);
    expect(q.pending().map((n) => n.sessionKey)).toEqual(['s2']);
  });

  it('solicitação repetida não perde o lugar na fila', () => {
    const { q, advance } = queue();
    const a = q.push(perm('a', 's1')).item;
    advance(10);
    q.push(perm('b', 's2'));
    advance(10);
    q.push(perm('a', 's1')); // a mesma de novo
    expect(q.pending()[0]!.id).toBe(a.id);
    expect(q.pending()[0]!.count).toBe(2);
  });

  it('o limite descarta informativas, nunca solicitações pendentes', () => {
    const { q } = queue();
    for (let i = 0; i < MAX_ITEMS; i++) q.push(perm(`p${i}`, `s${i}`));
    q.push({ kind: 'info', title: 'I', message: 'extra' });
    expect(q.pending()).toHaveLength(MAX_ITEMS);
  });
});
