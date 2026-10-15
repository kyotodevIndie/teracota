import { describe, expect, it } from 'vitest';
import { INITIAL_CONTEXT, deriveVisualState, isOpen, type CompanionContext } from './visual-state';

const state = (patch: Partial<CompanionContext>) => deriveVisualState({ ...INITIAL_CONTEXT, ...patch });

describe('deriveVisualState', () => {
  it('começa no modo mini', () => {
    expect(state({})).toBe('MINI');
  });

  it('agente trabalhando só mostra o indicador, sem expandir', () => {
    expect(state({ working: true })).toBe('WORKING');
    expect(isOpen('WORKING')).toBe(false);
  });

  it('hover ou clique (fixada) expandem', () => {
    expect(state({ hovering: true })).toBe('EXPANDED');
    expect(state({ pinned: true })).toBe('EXPANDED');
  });

  it('solicitação pendente vence tudo, inclusive interação, arrasto e menu', () => {
    const pending = { pending: true, topKind: 'permission' as const };
    expect(state({ ...pending })).toBe('ATTENTION');
    expect(state({ ...pending, hovering: true, draggingFiles: true, panelOpen: true, working: true })).toBe('ATTENTION');
  });

  it('solicitação recolhida pelo usuário: volta pro resto da prioridade', () => {
    const collapsed = { pending: true, topKind: 'permission' as const, attentionCollapsed: true };
    expect(state(collapsed)).toBe('MINI');
    expect(state({ ...collapsed, working: true })).toBe('WORKING');
    expect(state({ ...collapsed, hovering: true })).toBe('EXPANDED');
  });

  it('arrastar arquivo vence a interação comum', () => {
    expect(state({ draggingFiles: true, hovering: true })).toBe('DRAGGING');
  });

  it('erro e conclusão viram notificação temporária, abaixo da interação', () => {
    expect(state({ topKind: 'error' })).toBe('NOTIFICATION');
    expect(state({ topKind: 'completion', working: true })).toBe('NOTIFICATION');
    expect(state({ topKind: 'error', hovering: true })).toBe('EXPANDED');
  });

  it('silenciado: notificações não críticas não expandem sozinhas', () => {
    expect(state({ topKind: 'completion', muted: true })).toBe('MINI');
    expect(state({ topKind: 'error', muted: true, working: true })).toBe('WORKING');
    // solicitação não é silenciável
    expect(state({ topKind: 'permission', pending: true, muted: true })).toBe('ATTENTION');
  });

  it('menu aberto fica acima do arrasto e da interação', () => {
    expect(state({ panelOpen: true, hovering: true, draggingFiles: true })).toBe('PANEL');
  });
});
