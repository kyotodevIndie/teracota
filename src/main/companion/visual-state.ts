// Máquina de estados visual do Mini Companion.
//
// O estado visual é UM valor, derivado de fatos independentes (o contexto). Assim não
// existem combinações inválidas tipo "expandido e minimizado": cada fato muda sozinho
// (mouse em cima, arquivo sendo arrastado, solicitação pendente...) e a prioridade
// abaixo decide o que aparece.
//
// Prioridade (da maior pra menor):
//   1. ATTENTION     solicitação pendente (permissão/pergunta) — não recolhe sozinha
//   2. PANEL         menu completo aberto
//   3. DRAGGING      arquivo sendo arrastado por cima
//   4. EXPANDED      interação direta (mouse em cima ou fixada com clique)
//   5. NOTIFICATION  erro/conclusão recente (temporária; silenciável)
//   6. WORKING       agente trabalhando (só um indicador, sem expandir)
//   7. MINI
//
// O usuário pode recolher a atenção (clique) — ela volta a expandir quando chegar
// outra solicitação. A solicitação continua na fila e o badge continua visível.
import type { NotificationKind, VisualState } from '../../shared/companion';

export interface CompanionContext {
  /** Cursor em cima da área visível */
  hovering: boolean;
  /** Fixada aberta por um clique */
  pinned: boolean;
  /** Arquivo sendo arrastado por cima */
  draggingFiles: boolean;
  /** Menu completo aberto */
  panelOpen: boolean;
  /** Tipo da notificação mais importante ativa (null = nenhuma) */
  topKind: NotificationKind | null;
  /** Há solicitação pendente */
  pending: boolean;
  /** O usuário recolheu as solicitações pendentes atuais */
  attentionCollapsed: boolean;
  /** Notificações não críticas não expandem sozinhas */
  muted: boolean;
  /** Algum agente trabalhando */
  working: boolean;
}

export const INITIAL_CONTEXT: CompanionContext = {
  hovering: false,
  pinned: false,
  draggingFiles: false,
  panelOpen: false,
  topKind: null,
  pending: false,
  attentionCollapsed: false,
  muted: false,
  working: false,
};

export function deriveVisualState(c: CompanionContext): VisualState {
  if (c.pending && !c.attentionCollapsed) return 'ATTENTION';
  if (c.panelOpen) return 'PANEL';
  if (c.draggingFiles) return 'DRAGGING';
  if (c.hovering || c.pinned) return 'EXPANDED';
  if (c.topKind && !c.pending && !c.muted && (c.topKind === 'error' || c.topKind === 'completion' || c.topKind === 'info')) {
    return 'NOTIFICATION';
  }
  if (c.working) return 'WORKING';
  return 'MINI';
}

/** Estados em que a barra fica aberta (largura expandida) */
export const isOpen = (s: VisualState): boolean => s !== 'MINI' && s !== 'WORKING';
