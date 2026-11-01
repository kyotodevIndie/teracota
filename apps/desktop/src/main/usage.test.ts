import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
vi.mock('./integrations', () => ({ providerInfo: (p: string) => ({ displayName: p === 'claude-code' ? 'Claude Code' : p, badge: { text: 'C', color: '#d97757' } }) }));
const { UsageStore } = await import('./usage');

describe('limites por IA', () => {
  it('guarda por IA, avisa quando muda e não repete aviso igual', () => {
    const store = new UsageStore();
    const cb = vi.fn();
    store.onChange(cb);
    const w = [{ id: 'five_hour' as const, usedPct: 40, resetsAt: null }];
    store.set('claude-code', w);
    store.set('claude-code', w);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.list()[0]).toMatchObject({ provider: 'claude-code', displayName: 'Claude Code', windows: w });
  });

  it('janela que já resetou some; sem janelas, some a IA', () => {
    const store = new UsageStore();
    store.set('claude-code', [{ id: 'five_hour', usedPct: 90, resetsAt: 1000 }, { id: 'seven_day', usedPct: 10, resetsAt: 9000 }]);
    expect(store.list(5000)[0]!.windows.map((w) => w.id)).toEqual(['seven_day']);
    expect(store.list(10_000)).toEqual([]);
    store.set('claude-code', []);
    expect(store.list(0)).toEqual([]);
  });
});
