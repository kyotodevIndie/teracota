// Eventos simulados pra validar o comportamento da janela antes de ligar os hooks reais.
// Só existe em desenvolvimento (o IPC de simulação é ignorado no app instalado).
import type { CompanionController } from './controller';

export const SCENARIOS = {
  permission: 'Pedido de permissão',
  question: 'Pergunta do agente',
  error: 'Erro',
  'error-repeat': 'Erro repetido 3× (agrupa)',
  completion: 'Tarefa concluída',
  'working-on': 'Agente começou a trabalhar',
  'working-off': 'Agente parou de trabalhar',
  burst: '3 solicitações + erro + conclusão ao mesmo tempo',
  'resolve-oldest': 'Resolver a solicitação mais antiga (como se respondesse no terminal)',
  reset: 'Limpar tudo',
} as const;

export type Scenario = keyof typeof SCENARIOS;

export const isScenario = (s: unknown): s is Scenario => typeof s === 'string' && s in SCENARIOS;

let n = 0;
const ids: string[] = [];

export function runScenario(c: CompanionController, scenario: Scenario): void {
  const session = (i: number) => ({ sessionKey: `sim:${i}`, origin: ['Claude Code · teracota', 'Claude Code · site', 'Claude Code · api'][i % 3]! });
  switch (scenario) {
    case 'permission':
      ids.push(c.notify({ kind: 'permission', title: 'Precisa de permissão', message: `Quer rodar: npm run build (#${++n})`, ...session(n) }).id);
      return;
    case 'question':
      ids.push(c.notify({ kind: 'question', title: 'Pergunta do agente', message: 'Qual banco de dados usar: Postgres ou SQLite?', ...session(1) }).id);
      return;
    case 'error':
      c.notify({ kind: 'error', title: 'Deu erro', message: 'O comando "npm test" falhou.', ...session(0) });
      return;
    case 'error-repeat':
      for (let i = 0; i < 3; i++) c.notify({ kind: 'error', title: 'Deu erro', message: 'Falha ao ler o arquivo.', ...session(2) });
      return;
    case 'completion':
      c.notify({ kind: 'completion', title: 'Tarefa concluída', message: 'Terminei de refatorar o manager.', ...session(0) });
      return;
    case 'working-on':
      c.setWorking(true);
      return;
    case 'working-off':
      c.setWorking(false);
      return;
    case 'burst':
      for (let i = 0; i < 3; i++) {
        ids.push(c.notify({ kind: 'permission', title: 'Precisa de permissão', message: `Quer editar src/arquivo-${i + 1}.ts`, ...session(i) }).id);
      }
      c.notify({ kind: 'error', title: 'Deu erro', message: 'O build quebrou.', ...session(1) });
      c.notify({ kind: 'completion', title: 'Tarefa concluída', message: 'Testes passaram.', ...session(2) });
      return;
    case 'resolve-oldest': {
      const id = ids.shift();
      if (id) c.resolve(id);
      return;
    }
    case 'reset':
      for (const id of ids.splice(0)) c.resolve(id);
      c.setWorking(false);
      return;
  }
}
