import { describe, expect, it } from 'vitest';
import type { BridgeEvent, BridgeEventBody } from '../../shared/bridge';
import type { AgentSignal } from '../integrations/types';
import { linkBridgeToCompanion } from './companion-link';

const H = 'h-1';
const SOURCE = { provider: 'prov', sessionId: H, project: 'proj' };

function setup() {
  const listeners: ((e: BridgeEvent) => void)[] = [];
  const signals: AgentSignal[] = [];
  let known = true;
  linkBridgeToCompanion(
    { onEvent: (cb) => { listeners.push(cb); return () => {}; } },
    (s) => signals.push(s),
    (h) => (known && h === H ? { providerId: 'prov', cwdLabel: 'proj' } : undefined),
  );
  const emit = (body: BridgeEventBody) => { for (const l of listeners) l({ ...body, handle: H } as BridgeEvent); }
  const state = (s: Extract<BridgeEventBody, { type: 'state' }>['state']) => emit({ type: 'state', state: s });
  return { signals, emit, state, forget: () => { known = false; } };
}

describe('companion-link: evento do bridge -> sinal da Tera', () => {
  it('sessão iniciada (primeiro idle): lifecycle start + atenção', () => {
    const t = setup();
    t.state('starting');
    expect(t.signals).toEqual([]);
    t.state('idle');
    expect(t.signals).toEqual([
      { source: SOURCE, lifecycle: 'start', event: { state: 'attention', duration: 3000, say: 'Sessão iniciada no painel.' } },
    ]);
  });

  it('agente trabalhando: running -> thinking; ferramenta usa a atividade (ou thinking)', () => {
    const t = setup();
    t.state('idle');
    t.signals.length = 0;
    t.state('running');
    t.emit({ type: 'tool', name: 'Read', summary: 'a.ts', activity: 'reading' });
    t.emit({ type: 'tool', name: 'X', summary: '' });
    expect(t.signals).toEqual([
      { source: SOURCE, working: true, event: { state: 'thinking', working: true } },
      { source: SOURCE, working: true, event: { state: 'reading', working: true } },
      { source: SOURCE, working: true, event: { state: 'thinking', working: true } },
    ]);
  });

  it('aguardando permissão: atenção com working', () => {
    const t = setup();
    t.emit({ type: 'permission-request', id: 'p', toolName: 'Bash', detail: 'rm -rf segredo', outsideCwd: false });
    expect(t.signals).toEqual([
      { source: SOURCE, working: true, event: { state: 'attention', working: true, say: 'Preciso da sua permissão no painel.' } },
    ]);
  });

  it('resposta recebida: só o primeiro delta do turno gera sinal; message é ignorada', () => {
    const t = setup();
    t.state('idle');
    t.state('running');
    t.signals.length = 0;
    t.emit({ type: 'text-delta', text: 'a' });
    t.emit({ type: 'text-delta', text: 'b' });
    t.emit({ type: 'message', role: 'assistant', text: 'ab' });
    t.emit({ type: 'message', role: 'user', text: 'oi' });
    expect(t.signals).toEqual([{ source: SOURCE, working: true, event: { state: 'typing', working: true } }]);
    // novo turno: de novo um sinal
    t.state('done');
    t.state('running');
    t.signals.length = 0;
    t.emit({ type: 'text-delta', text: 'c' });
    expect(t.signals).toHaveLength(1);
  });

  it('turno concluído / erro / interrompido', () => {
    const t = setup();
    t.emit({ type: 'turn-end', outcome: 'done' });
    t.emit({ type: 'turn-end', outcome: 'error', message: 'detalhe sensível do agente' });
    t.emit({ type: 'turn-end', outcome: 'cancelled' });
    expect(t.signals).toEqual([
      { source: SOURCE, working: false, event: { state: 'happy', working: false, say: 'Pronto!' } },
      { source: SOURCE, working: false, event: { state: 'error', working: false, say: 'Hmm, deu erro.' } },
      { source: SOURCE, working: false, event: { state: 'idle', working: false, say: 'Interrompido.' } },
    ]);
  });

  it('sessão encerrada: end + sleeping; closed sem start só apaga', () => {
    const t = setup();
    t.state('idle');
    t.signals.length = 0;
    t.state('closed');
    expect(t.signals).toEqual([
      { source: SOURCE, lifecycle: 'end', working: false, event: { state: 'sleeping', working: false, say: 'Até mais! 💤' } },
    ]);

    const u = setup();
    u.state('starting');
    u.state('closed');
    expect(u.signals).toEqual([]);
  });

  it('demais eventos não geram sinal; sessão desconhecida é ignorada', () => {
    const t = setup();
    t.emit({ type: 'session', sessionId: 's', cwdLabel: 'proj', model: 'm' });
    t.state('done');
    t.state('waiting-permission');
    t.emit({ type: 'permission-resolved', id: 'p', allow: true });
    expect(t.signals).toEqual([]);
    const u = setup();
    u.forget();
    u.state('idle');
    expect(u.signals).toEqual([]);
  });

  it('nenhum sinal carrega texto do usuário ou do agente', () => {
    const t = setup();
    t.state('idle');
    t.state('running');
    t.emit({ type: 'message', role: 'user', text: 'SEGREDO-USUARIO' });
    t.emit({ type: 'tool', name: 'Bash', summary: 'SEGREDO-FERRAMENTA', activity: 'terminal' });
    t.emit({ type: 'permission-request', id: 'p', toolName: 'Bash', detail: 'SEGREDO-DETALHE', outsideCwd: true });
    t.emit({ type: 'text-delta', text: 'SEGREDO-AGENTE' });
    t.emit({ type: 'message', role: 'assistant', text: 'SEGREDO-AGENTE' });
    t.emit({ type: 'turn-end', outcome: 'error', message: 'SEGREDO-ERRO' });
    expect(JSON.stringify(t.signals)).not.toContain('SEGREDO');
  });
});
