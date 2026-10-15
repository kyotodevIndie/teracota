import { describe, expect, it, vi } from 'vitest';
import type { CompanionView } from '../../shared/companion';
import { CompanionController, HOVER_CLOSE_MS, HOVER_OPEN_MS, type Clock, type CompanionSurface } from './controller';

/** Relógio falso: timers só disparam quando o teste avança o tempo */
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at).find(([, v]) => v.at <= end);
      if (!next) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
    }
    t = end;
  };
  return { clock, advance };
}

function setup(opts: { muted?: boolean } = {}) {
  const views: CompanionView[] = [];
  const surface: CompanionSurface = { anchor: 'right', render: (v) => views.push(v), openMenu: vi.fn() };
  const { clock, advance } = fakeClock();
  const c = new CompanionController(surface, { clock, muted: opts.muted });
  return { c, views, surface, advance, last: () => views[views.length - 1]! };
}

const permission = (message: string, sessionKey = 'claude-code:a') =>
  ({ kind: 'permission' as const, title: 'Precisa de permissão', message, sessionKey, origin: 'Claude Code · teracota' });

describe('CompanionController', () => {
  it('hover expande depois de um instante e recolhe quando o mouse sai', () => {
    const { c, advance } = setup();
    c.input({ type: 'hover', over: true });
    expect(c.state).toBe('MINI'); // passar o mouse de passagem não abre
    advance(HOVER_OPEN_MS);
    expect(c.state).toBe('EXPANDED');
    c.input({ type: 'hover', over: false });
    advance(HOVER_CLOSE_MS - 1);
    expect(c.state).toBe('EXPANDED');
    advance(1);
    expect(c.state).toBe('MINI');
  });

  it('clique fixa aberta e outro clique solta', () => {
    const { c } = setup();
    c.input({ type: 'click' });
    expect(c.state).toBe('EXPANDED');
    c.input({ type: 'click' });
    expect(c.state).toBe('MINI');
  });

  it('solicitação expande sozinha e não recolhe com o tempo nem quando o mouse sai', () => {
    const { c, advance } = setup();
    c.notify(permission('rodar npm test'));
    expect(c.state).toBe('ATTENTION');
    c.input({ type: 'hover', over: true });
    advance(HOVER_OPEN_MS);
    c.input({ type: 'hover', over: false });
    advance(60 * 60 * 1000);
    expect(c.state).toBe('ATTENTION');
  });

  it('a notificação de permissão só oferece ações que funcionam (sem botão de aprovar)', () => {
    const { c, last } = setup();
    c.notify(permission('rodar npm test'));
    const ids = last().notification!.actions.map((a) => a.id);
    expect(ids).toEqual(['acknowledge']);
    expect(ids).not.toContain('approve');
  });

  it('erro que chega depois não substitui a solicitação em destaque', () => {
    const { c, last } = setup();
    c.notify(permission('editar arquivo'));
    c.notify({ kind: 'error', title: 'Deu erro', message: 'build quebrou', sessionKey: 'claude-code:b' });
    expect(c.state).toBe('ATTENTION');
    expect(last().notification!.message).toBe('editar arquivo');
    expect(last().queue.total).toBe(2);
  });

  it('recolher a atenção mantém o badge; solicitação nova expande de novo', () => {
    const { c, last } = setup();
    c.notify(permission('a'));
    c.input({ type: 'click' });
    expect(c.state).toBe('MINI');
    expect(last().pendingCount).toBe(1);
    c.notify(permission('b', 'claude-code:b'));
    expect(c.state).toBe('ATTENTION');
    expect(last().pendingCount).toBe(2);
  });

  it('navega entre várias solicitações', () => {
    const { c, last } = setup();
    c.notify(permission('a', 's1'));
    c.notify(permission('b', 's2'));
    c.notify(permission('c', 's3'));
    expect(last().notification!.message).toBe('a');
    c.input({ type: 'navigate', delta: 1 });
    expect(last().notification!.message).toBe('b');
    expect(last().queue).toEqual({ index: 1, total: 3 });
    c.input({ type: 'navigate', delta: -1 });
    c.input({ type: 'navigate', delta: -1 });
    expect(last().notification!.message).toBe('c');
  });

  it('"vou ver no terminal" resolve só aquela e mostra a próxima', () => {
    const { c, last } = setup();
    const a = c.notify(permission('a', 's1'));
    c.notify(permission('b', 's2'));
    c.input({ type: 'action', id: 'acknowledge', notificationId: a.id });
    expect(c.state).toBe('ATTENTION');
    expect(last().notification!.message).toBe('b');
  });

  it('resolveSession: a sessão seguiu em frente, a solicitação dela sai', () => {
    const { c } = setup();
    c.notify(permission('a', 's1'));
    c.resolveSession('s1');
    expect(c.state).toBe('MINI');
  });

  it('conclusão expande por um tempo e recolhe sozinha', () => {
    const { c, advance } = setup();
    c.notify({ kind: 'completion', title: 'Pronto', message: 'feito' });
    expect(c.state).toBe('NOTIFICATION');
    advance(6000);
    expect(c.state).toBe('MINI');
  });

  it('silenciado: conclusão não expande; solicitação ainda expande', () => {
    const { c } = setup({ muted: true });
    c.notify({ kind: 'completion', title: 'Pronto', message: 'feito' });
    expect(c.state).toBe('MINI');
    c.notify(permission('a'));
    expect(c.state).toBe('ATTENTION');
  });

  it('soltar arquivos não finge envio: avisa que nada foi enviado', () => {
    const { c, last } = setup();
    c.input({ type: 'drag-files', over: true });
    expect(c.state).toBe('DRAGGING');
    expect(last().drop).not.toBeNull();
    c.input({ type: 'drop-files', names: ['a.png'] });
    expect(c.state).toBe('NOTIFICATION');
    expect(last().notification!.message).toMatch(/Nada foi enviado/);
  });

  it('trabalhando aparece como indicador, sem expandir', () => {
    const { c, last } = setup();
    c.setWorking(true);
    expect(c.state).toBe('WORKING');
    expect(last().working).toBe(true);
    expect(last().notification).toBeNull();
  });

  it('não reenvia o mesmo view à toa', () => {
    const { c, views } = setup();
    c.render();
    const n = views.length;
    c.render();
    c.setWorking(false);
    expect(views.length).toBe(n);
  });
});
