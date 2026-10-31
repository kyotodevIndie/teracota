// Agent Bridge: sessões de agente (provider → manager → eventos pra UI). Node, sem Electron.
// O contrato (eventos e estados) fica em '@tera/agent-bridge/contract', que também roda no renderer.
export * from './manager';
export * from './simulated';
export type * from './types';
