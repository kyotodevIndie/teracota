# Tera Pocket — Fase 1: relatório final

Worktree `K:\dev\waifu-claude-phase1`, branch `feat/tera-pocket-phase1` (base 05dc270). **Nada foi commitado.** Estado detalhado e histórico de decisões: `docs/TERA_POCKET_PHASE1_PROGRESS.md`.

## 1. Veredito
**Tecnicamente concluída**, com as limitações da seção 8 e os testes manuais da seção 10 ainda a executar por uma pessoa.
Critérios (§18 do pedido): Core/SQLite ✔, estados e transições ✔, runner Claude Code real ✔, aprovações seguras ✔, exclusividade de execução ✔ (lock do kernel + Job Object; sem isolamento absoluto), crash sem reexecução automática ✔, reconciliação exige o usuário ✔, testes essenciais ✔, Electron funcional ✔ (dev e empacotado), revisões Opus sem achado bloqueante ✔, este relatório ✔.

## 2. O que foi entregue
| Etapa | Entrega |
|---|---|
| A — Core | SQLite (`node:sqlite`, WAL, `synchronous=FULL`), journal append-only, ledger de efeitos, aprovações, gestos de uso único, fence, migrações com backup/checksum, triggers protegendo invariantes |
| B — Processos | Lock nativo (named pipe do Windows), `openCore` (lock → banco → varredura de órfãos), supervisor, **Job Object (koffi) por execução**, varredura de órfãos por pid + tempo de criação |
| C — Adapter | `ClaudeCodeRunner` (SDK oficial, streaming input, `settingSources: []`, PreToolUse + `canUseTool`), eventos normalizados v1, SDK falso |
| D — Segurança | Confinamento por realpath (symlink/junction/hardlink/UNC/ADS/NFC), Bash conservador (Git Bash: `\` é escape; MSYS), credenciais/config do Claude Code/dados do Teracota negados, HMAC em memória, TTL 10 min, uso único, fencing antes de efeitos |
| E — Orquestrador | Início manual, interrupção (10 s), cancelamento só com saída limpa, retomada com prompt editável, retry ≤3 (só transitórios, antes de efeito), `success → review` |
| F — Reconciliação | R1–R6, evidência sem conteúdo (tipos do transcrito, hash de efeitos), git só sob gesto, ack explícito para retomar |
| G — Electron | Janela "Tera Pocket" (menu), IPC validado, sandbox + CSP, UI de tarefas/aprovações/reconciliação; companion intocado |

Dependências adicionadas: `@anthropic-ai/claude-agent-sdk@0.3.296`, `@anthropic-ai/sdk` (peer), `koffi@3.3.3` (aprovado), `zod` 3→4 (peer do SDK; `src/main/mcp.ts` compila e os testes passam). O binário do `claude` empacotado pelo SDK é excluído do instalador; usa-se o `claude.exe` do PATH do usuário (só entradas absolutas).

## 3. Job Object (decisão aprovada: koffi)
- `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, **um job por execução**, sem flags de breakaway; todo descendente (inclusive o que o Bash do agente roda em segundo plano) entra no mesmo job.
- **Associação antes de comandos:** o stdin do runner é um portão (`PassThrough`) que só abre depois de `AssignProcessToJobObject` + `IsProcessInJob` confirmarem. O runner só recebe o prompt depois disso.
- **Falha segura:** sem koffi/API/job → `PocketService.start` lança **antes** de abrir banco ou tomar lock (a janela mostra o erro). Falha de associação → processo morto sem entrada, evento `containment_failed` no journal.
- Fim da execução (normal, forçado ou crash do host) fecha o job → o SO encerra tudo que estava nele.
- Compatível com Electron 44 e com o pacote (`koffi.node` sai em `app.asar.unpacked`; `status.containment = "job-object"` no app empacotado).

## 4. Testes automatizados
`npm run check` (typecheck + lint + vitest): **471 testes, 27 arquivos, todos passando; lint com 1 aviso de CSS**; `npm run build` ok; `npm run pack` ok. Novos testes do Pocket: ~320 (estados 13×13, migrações, gestos, aprovações, kill -9 em escrita, locks entre processos reais, processos/órfãos, Job Object, adapter, política de caminhos/Bash, orquestrador, R1–R6, IPC/UI).
Testes reais de processo no Windows (`process/job-object.test.ts`, `process.test.ts`, `process-hardening.test.ts`): árvore via `cmd.exe → ping` morre em (a) kill forçado, (b) fim normal do runner, (c) **crash do host (kill -9)**; exit antes da associação não vaza job nem faz `taskkill` em pid reaproveitado; falha de Job/Assign/Open/IsInJob → runner sem entrada.
Os 29 testes do PoC da Fase 0.5 testavam o lock de arquivo/JSONL (substituídos); os cenários equivalentes foram reimplementados contra o novo Core (A/B/C/D/E/F/G/H → `process.test`, `store.test`, `recovery.test`, `reconcile.test`, `orchestrator.test`, `permission-hooks.test`).

## 5. Evidências com o Claude Code real (2.1.224, `haiku`, pasta temporária, só comandos não destrutivos)
- Resposta simples: `queued→running→review`; `started` com modelo e versão reais.
- `Write` dentro do workspace: PreToolUse devolveu `ask` → `canUseTool` → `allow` automático; efeito `confirmed` no ledger.
- `Bash rm hello.txt`: classificado destrutivo → aprovação → **negada** pelo usuário → arquivo permaneceu.
- Interromper: **643 ms**, saída limpa; retomar com `sessionId` escolhido pelo host funcionou.
- Descoberto: o modelo trabalha com caminhos MSYS (`/tmp/...` = `%TEMP%`); `\tmp\x` resolve para `C:\tmp\x` → classificado fora do workspace (comportamento correto: pede aprovação).
- **Decisivo (Job Object):** com um `ping` em segundo plano iniciado pelo Bash, `kill -9` no host → `claude.exe` **e** o `ping` morreram. (Sem Job Object, o `ping` sobrevivia — isso motivou a decisão.)
- Smoke do app (dev e empacotado) via CDP: janela abre, API sem Node vazado, validação de pasta (`%TEMP%`, HOME, relativa → recusadas; subpasta do HOME ok), criar/listar/evidência/cancelar.

## 6. Revisões
| Quando | Modelo | Resultado |
|---|---|---|
| A | Sonnet reviewer; Opus architect | com ressalvas; REPROVADO → tudo corrigido (V1 ainda não publicada) |
| B | Opus | com ressalvas → corrigido |
| B+C+D | Sonnet | com ressalvas → corrigido |
| D | Opus (2 rodadas) | REPROVADO ×2 → bypass de credenciais (Git Bash `\`), UNC, precheck, etc. corrigidos; 2ª re-revisão aprovou |
| E+F | Sonnet; Opus (parcial) | corrigido |
| F+G | Opus (parcial) | corrigido (git sob gesto, validateCwd, trusted()…) |
| Job Object + pendências | Sonnet reviewer | 3 corridas reais (exit antes de adopt, handle fechado no sweep, `child.stdin` sem listener) → **corrigidas e testadas** |
| **Consolidada final** | **Opus** | **aprovada, sem achados bloqueantes** (duas passadas: segurança/arquitetura e gestos/ack/diffs do companion/textos) |
Os pareceres do Opus vieram do subagente `architect` (Opus); nenhum parecer foi atribuído a modelo errado.

## 7. Bugs relevantes encontrados e corrigidos
Rastreio de descendentes sobreposto (PowerShell em fila); `kill()` derrubava a raiz antes do `taskkill /T`; sessão `session_expired` arquivada antes do lock; aprovação `allow` por ator sistema; gesto sem tipo/propósito; `LOCK_LOST` virando `interrupted`; 2 aprovações pendentes travando; teste de lock com dono bloqueado; vazamento do slot no release; PID reaproveitado em `taskkill`; entre outros (ver PROGRESS).

## 8. Limitações conhecidas (não há isolamento absoluto)
- O Job Object **não é sandbox**: não limita leitura/escrita/rede. Processos criados *fora* do job continuam fora: serviços do Windows (`schtasks`, `sc start`, WMI/`wmic process call create`), pedidos a processos já em execução (`explorer.exe`, DDE/associação de arquivo) e servidores COM/DCOM.
- Intervalo de microssegundos entre `CreateProcess` e a associação: o runner ainda não recebeu entrada (portão), mas código do próprio `claude` na inicialização pode criar filhos antes; a varredura posterior os traz ao job (mitigação, não garantia).
- Ao fim normal da execução, o que o agente deixou **em segundo plano é encerrado** (ex.: `npm run dev &`).
- `canUseTool`/PreToolUse são o portão de permissão; `credentialInCommand` é heurística por tokens (ex.: `cd ~ && cat .claude/...` não é pego; a defesa real é a aprovação de comandos não classificados). Reads/Bash que o CLI auto-libera passam pelo PreToolUse `ask` apenas se a política mandar perguntar.
- Gesto = "comando vindo da janela confiável" (sandbox + CSP + `textContent`); não prova clique humano. Um renderer comprometido equivale a aprovar tudo.
- `git status` (evidência) pode executar filtros clean do `.git/config` do repositório; por isso só roda com clique e ambiente mínimo (risco residual aceito, N2 do Opus).
- Erros reais de autenticação, sessão inexistente e limite de uso **não foram provocados**; o mapeamento é defensivo e **não verificado** contra o Claude real.
- Windows apenas (POSIX bloqueado). Só `claude.exe` (instalação npm `claude.cmd` não é encontrada). Uma tarefa ativa por vez.
- Cancelar em `awaiting_approval` já consome o gesto na hora; ack/efeitos não são reverificados após o `acquire` no `resumeTask` (janela pequena, dentro de `exclusive`).
- Sessão reservada órfã se a retomada com sessão nova falhar após a transição (tarefa vai a `needs_reconcile`).
- `vitest.config.mts` novo; `zod` 4 (peer do SDK).

## 9. Riscos residuais
Prompt injection que induza o agente a tarefas permitidas dentro do workspace (escrita livre é decisão aprovada); itens da seção 8; dependência de `koffi` (FFI nativa) e de detalhes do libuv/Windows para jobs aninhados; formato dos erros reais do Claude; abandono de background no fim normal pode surpreender.

## 10. Checklist manual (não executado por mim)
1. Instalar o `release/` gerado em máquina limpa; abrir "Tera Pocket (tarefas)…" e conferir banner "Claude Code encontrado".
2. Criar tarefa em subpasta do HOME; tentar HOME, `%APPDATA%`, `C:\` e a pasta do app (devem ser recusadas).
3. Iniciar tarefa real; aprovar e negar uma ação destrutiva; ver o contador de expiração (10 min) e a expiração real.
4. Interromper em execução; retomar editando o prompt; cancelar em `awaiting_approval`.
5. Matar o app (Gerenciador de Tarefas) durante uma execução com `ping` em segundo plano; reabrir: tarefa em `needs_reconcile`, nenhum `ping`/`claude.exe` vivo; revisar evidência, decidir efeitos, "Revisei", retomar.
6. "Verificar alterações com git" apenas em repositório confiável.
7. Fechar o app com tarefa rodando (≤5 s): tarefa vira `interrupted`/`needs_reconcile`, sem processos órfãos.
8. Duas instâncias do app: a segunda não toca no banco (LOCK_BUSY).
9. Logout do `claude` e nova tarefa → `auth_error` (observar o formato real e ajustar `classify.ts` se divergir); limite de uso só se ocorrer naturalmente.
10. Companion: Tera, tray, transparência, click-through, multi-sessão e menu inalterados.

## 11. Próximos passos
Commit/PR quando validado; decisão sobre aviso na UI para o encerramento de processos em segundo plano; mapear erros reais de auth/sessão/limite; instalador completo (`npm run dist`) e teste em máquina limpa; scheduler opcional (hoje só manual); suporte a `claude.cmd`.

## 12. Compatibilidade com Electron
Electron 44.4.5 (Node 24.21, SQLite 3.53.4): `node:sqlite`, koffi, named pipes, SDK por `import()` dinâmico e CSP/sandbox verificados no app em modo dev e empacotado (`electron-builder --dir`).
