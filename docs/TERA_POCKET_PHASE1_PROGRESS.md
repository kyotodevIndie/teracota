# Tera Pocket — Fase 1: progresso

Worktree: `K:\dev\waifu-claude-phase1` (branch `feat/tera-pocket-phase1`, base 05dc270). **Sem commits** (a pedido do usuário: validar antes).
O trabalho não commitado de `feat/mini-companion` (companion/UI mini) NÃO está neste worktree; a integração Electron (Etapa G) é aditiva sobre 05dc270.
Docs da Fase 0/0.5 foram copiados de `waifu-claude-pocket` (estavam sem commit lá) para `docs/` e `docs/phase0/`; o PoC para `poc/` (sem node_modules/tauri).

## Decisões técnicas desta fase (dentro das 12 aprovadas)
- SQLite: `node:sqlite` embutido (Electron 44.4.5 = Node 24.21, SQLite 3.53.4); verificado sob `ELECTRON_RUN_AS_NODE`. Sem dependência nativa.
- Dependências adicionadas: `@anthropic-ai/claude-agent-sdk@0.3.296` (autorizada), `@anthropic-ai/sdk` (peer), `zod` 3→4 (peer `^4` do SDK; typecheck e os 123 testes antigos seguem verdes).
- `vitest.config.ts` novo (exclui `poc/`, que usa `node:test`).
- Lock nativo = named pipe do Windows (sem addon). POSIX bloqueado na Fase 1.

## Checkpoints

### Etapa A — Core + SQLite (concluída; Reviewer/Sonnet COM RESSALVAS + Architect/Opus REPROVADO → tudo corrigido)
- Arquivos: `src/shared/pocket.ts`, `src/main/pocket/core/{states,schema,db,store}.ts`, testes `store.test.ts`, `hardening.test.ts`, `recovery.test.ts`, `testing/*`.
- Correções (na própria V1, ainda não publicada): allow só por usuário (JS+trigger); gesto amarrado a tipo/propósito/tarefa; aprovação com `decided_fence` e run vivo; aprovação composta (1 gesto = decide + volta a running); trigger `tasks_state_matches_journal` (journal antes do UPDATE); `running→completed` removido; `awaiting_approval→cancelled` exige saída limpa; savepoints em tx aninhado; `beginRun` valida sessão/tarefa; redação de segredos; checkpoint WAL no close + `journal_size_limit`; migrações em tx única; `openReadOnly`; R6 = `deny` (não resolvido) / `reapprove` (user_applied/unknown).
- Não corrigido de propósito: `store.db` e `issueGesture` continuam públicos (não há fronteira de segurança dentro do processo; a barreira contra o agente é ele rodar em outro processo + HMAC em memória). Re-revisão Opus após a Etapa D.

### Etapa B — Lock e processos (concluída; Opus COM RESSALVAS → corrigidas; 1 decisão pendente do usuário)
- Arquivos: `process/{os-lock,proc-info,containment,supervisor}.ts`, `open-core.ts`, testes `process.test.ts`, `process-hardening.test.ts`, `open-core.test.ts`, workers em `testing/`.
- Lock: 6 processos disputando → 1 vence (3 rodadas); kill -9 libera na hora; dono com event loop bloqueado 3 s segue dono; filho detached não herda o handle; chave = usuário + caminho real.
- Ordem imposta por `openCore()`: lock → open/migração/fence → `sweepOrphans` (exige lock + fence).
- Processos: spawn registrado (pid + tempo de criação); `kill()` derruba a árvore antes do TerminateProcess; descendentes rastreados (15 s) e mortos quando o runner sai; varredura só mata com pid+startTime exatos; falha de consulta ≠ ausente.
- **Job Object / koffi**: PoC com koffi funcionou, mas o libuv já põe o FILHO DIRETO num Job KILL_ON_JOB_CLOSE (verificado em Electron 44 real: main morto ⇒ filho e neto-Node morrem; filho `detached` sobrevive). `koffi` **não foi adicionado**. Limite (Opus, de memória do libuv, não verificado): netos criados por intermediário não-libuv (ex.: `bash.exe → npm run dev`) ficam fora do job e só morrem na próxima inicialização, se rastreados.
- **DECISÃO DO USUÁRIO PENDENTE**: aceitar o limite acima, ou aprovar mecanismo de árvore inteira (koffi com job próprio sem SILENT_BREAKAWAY + launcher/trampolim para fechar a corrida spawn→assign). Não declarado como garantido.
- Pendente: teste decisivo com o `claude` real + Bash em background (host morto ⇒ netos?).

### Etapa C — Adapter Claude Code (implementada; revisão pendente)
- Arquivos: `runner/{types,classify,claude-runner}.ts`, `testing/fake-sdk.ts`, `runner/claude-runner.test.ts` (22 testes).
- SDK real: streaming input (necessário p/ interrupt), `settingSources: []` (regras de allow em settings pulariam o canUseTool), `permissionMode: default`, env sem `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`. Mapeamento de erros auth/sessão/limite **não verificado contra o Claude real**.
- Próximas: D (segurança/permissões), E (orquestrador), F (reconciliação), G (Electron), relatório final.

### Estado ao fim da sessão (limite de uso atingido)
- Etapas A–G implementadas; `npm run check` verde (447 testes, 293 novos), build ok, smoke no Electron 44 real ok, 3 sessões reais com claude 2.1.224 (haiku) ok.
- Revisões: Sonnet (A, C+D+B, E+F) e Opus (A, B, D x2, E parcial, F+G parcial) — correções aplicadas, exceto os itens abaixo.
- PENDENTE (revisão Opus F+G): validateCwd recusar HOME/ancestrais/AppData/pasta do app e do claude.exe; setProtectedPaths ampliado; resolveClaudeExecutable só PATH absoluto; timeout global (5 s) no before-quit; trusted() por URL exata; evidência com git só sob gesto na UI (core pronto: `includeGit`, falta botão/IPC); resumeTask (session_expired) travar a sessão antiga antes de mutar; credentialInCommand incluir isAgentConfig/protegidos e %APPDATA%; efeitos `intent` em interrupted/failed devem levar a needs_reconcile.
- PENDENTE geral: relatório final `docs/TERA_POCKET_PHASE1_REPORT.md` não escrito; decisão do usuário sobre koffi (netos do Bash sobrevivem ao host: verificado com claude real); mapeamento real de erros auth/sessão/limite não verificado; testes manuais; nenhuma revisão Opus final consolidada.

### Continuação (sessão 2) — concluída
- koffi aprovado e implementado (Job Object por execução, stdin com portão, falha segura); as 8 pendências do Opus corrigidas; revisões: Sonnet (Job Object: 3 corridas corrigidas) e Opus consolidado final **aprovado, sem bloqueantes** (2 passadas).
- Validação: `npm run check` 471 testes ok; build e `npm run pack` ok; smoke Electron dev e empacotado ok; Claude real: resposta, Write auto, rm negado, interrupt 643 ms, resume; kill -9 do host com `ping` em segundo plano → tudo morreu.
- Relatório final: `docs/TERA_POCKET_PHASE1_REPORT.md`. Sem commits.
