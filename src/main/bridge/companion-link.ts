// Agent Bridge -> Companion Core: traduz os eventos das sessões do painel em AgentSignals,
// o mesmo formato dos adapters de hooks. Assim a Tera reage à sessão do painel sem hooks,
// CLAUDE.md nem settings. Só metadados de ciclo de vida: nenhum texto do usuário ou do
// agente (nem de erro) vira sinal.
import type { BridgeEvent } from '../../shared/bridge';
import type { CompanionEvent } from '../../shared/protocol';
import type { AgentSignal, AgentSource } from '../integrations/types';

/** Quem é a sessão (só metadados); undefined = sessão desconhecida */
export type DescribeSession = (handle: string) => { providerId: string; cwdLabel: string } | undefined;

interface Link {
  source: AgentSource;
  started: boolean;
  streamed: boolean;
}

/** Evento do bridge -> sinal (null = ignorar). Isolado do estado pra ficar fácil de testar. */
function toSignal(link: Link, ev: BridgeEvent): AgentSignal | null {
  const { source } = link;
  const sig = (event: CompanionEvent | null, extra: Partial<AgentSignal> = {}): AgentSignal => ({ source, ...extra, event });
  switch (ev.type) {
    case 'state':
      switch (ev.state) {
        case 'idle':
          if (link.started) return null;
          link.started = true;
          return sig({ state: 'attention', duration: 3000, say: 'Sessão iniciada no painel.' }, { lifecycle: 'start' });
        case 'running':
          link.streamed = false;
          return sig({ state: 'thinking', working: true }, { working: true });
        case 'closed':
          return link.started
            ? sig({ state: 'sleeping', working: false, say: 'Até mais! 💤' }, { lifecycle: 'end', working: false })
            : null;
        default:
          return null;
      }
    case 'tool':
      return sig({ state: ev.activity ?? 'thinking', working: true }, { working: true });
    case 'permission-request':
      return sig({ state: 'attention', working: true, say: 'Preciso da sua permissão no painel.' }, { working: true });
    case 'text-delta':
      if (link.streamed) return null;
      link.streamed = true;
      return sig({ state: 'typing', working: true }, { working: true });
    case 'turn-end':
      if (ev.outcome === 'done') return sig({ state: 'happy', working: false, say: 'Pronto!' }, { working: false });
      if (ev.outcome === 'error') return sig({ state: 'error', working: false, say: 'Hmm, deu erro.' }, { working: false });
      return sig({ state: 'idle', working: false, say: 'Interrompido.' }, { working: false });
    default:
      return null;
  }
}

/** Liga o BridgeManager ao Companion Core; devolve a função que desfaz a ligação */
export function linkBridgeToCompanion(
  bridge: { onEvent(cb: (e: BridgeEvent) => void): () => void },
  onSignal: (signal: AgentSignal) => void,
  describe: DescribeSession,
): () => void {
  const links = new Map<string, Link>();
  return bridge.onEvent((ev) => {
    let link = links.get(ev.handle);
    if (!link) {
      const info = describe(ev.handle);
      if (!info) return;
      link = { source: { provider: info.providerId, sessionId: ev.handle, project: info.cwdLabel }, started: false, streamed: false };
      links.set(ev.handle, link);
    }
    const signal = toSignal(link, ev);
    if (ev.type === 'state' && ev.state === 'closed') links.delete(ev.handle);
    if (signal) onSignal(signal);
  });
}
