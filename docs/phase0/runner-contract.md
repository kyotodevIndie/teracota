# Tera Pocket — Contrato do runner (Fase 0.5)

Status: **desenho**. Nada implementado em `src/`. Base: `docs/TERA_POCKET_PHASE0_AUDIT.md`, `docs/phase0/poc-runner-results.md` (T1–T6, Claude real, n=1), `docs/phase0/safety/results.md` (runner falso, 29/29), `poc/runner-safety/lib/*`, spec §3.2–3.4 e §5.

Legenda de verificação:
- **[PoC-Claude]**: observado com o `claude` real (n=1).
- **[PoC-falso]**: coberto por teste com runner falso.
- **[Doc]**: só documentação oficial local.
- **[Não verificado]**: proposta sem evidência.

## 0. Princípios

- **Core**: fonte de verdade. Estados, journal, lock, aprovações, ledger de efeitos e reconciliação. Único escritor do journal (single-instance).
- **Adapter (Claude Code)**: não guarda estado. Traduz operações para o Agent SDK e o stream para eventos normalizados. Não muda estado de tarefa.
- **Host (Electron ou Tauri)**: cria e encerra a árvore de processos e entrega gestos do usuário (`userGestureId`). No Tauri, o adapter seria um sidecar Node via stdio [Não verificado].
- **Conformidade**:
  - só o binário oficial `claude`, sem modificação;
  - o Teracota não lê, grava nem pede credenciais (nada de `~/.claude/.credentials*`, tokens OAuth ou `ANTHROPIC_API_KEY` em nome do usuário);
  - login de assinatura só para uso pessoal local, feito pelo próprio usuário no binário oficial; distribuição a terceiros exige API key gerida pelo usuário ou decisão da Anthropic;
  - nenhum mecanismo de contorno de limite.

## 1. Contrato do runner

### 1.1 Interface (independente de host)

```ts
type RunnerCapabilities = {
  structuredEvents: boolean;      // [PoC-Claude]
  interrupt: boolean;             // [PoC-Claude] T2
  resumeSession: boolean;         // [PoC-Claude] T4 (n=1)
  hostChosenSessionId: boolean;   // [Doc] option sessionId; não testado
  persistentApproval: boolean;    // false no MVP
  usageMetrics: 'official' | 'estimate' | 'unavailable';
  authMode: 'user_managed';       // o Teracota nunca guarda credenciais
};

interface AgentRunner {
  id: string;                     // 'claude-code'
  capabilities(): Promise<RunnerCapabilities>;
  start(i: { taskId; runId; sessionId; cwd; prompt; policy }): Promise<{ runId }>;
  interrupt(runId, o: { reason: 'user' | 'cancel'; forceAfterMs: number }): Promise<InterruptOutcome>;
  resume(i: { taskId; runId; sessionId; cwd; prompt; userGestureId; policy }): Promise<{ runId }>;
  resolveApproval(runId, approvalRequestId, decision: SignedDecision): Promise<void>;
  onEvent(cb: (e: RunnerEvent) => void): () => void;
}
type InterruptOutcome = { accepted: boolean; outcome: 'interrupted' | 'forced_kill' | 'not_running' | 'already_pending' };
```

`runId` é gerado pelo core a cada execução (start ou resume) e entra em todo evento e aprovação.

### 1.2 Eventos normalizados

Envelope: `{ v:1, eventId, seq (por runId), taskId, sessionId, runId, ts, type, payload }`. Prompts e conteúdo de arquivos **nunca** entram no payload; só metadados e resumo truncado.

| type | Origem no Claude Code | Verificação |
|---|---|---|
| `started` `{resumed, model?, claudeVersion?, cwd}` | `system/init`; o core exige o `session_id` pedido | [PoC-Claude] T1; id escolhido pelo host: [Doc] |
| `activity` `{kind: text\|thinking\|tool_use\|tool_result\|status\|api_retry, toolName?, toolUseId?, summary?}` | `stream_event`, `assistant`, `user`, `api_retry` | [PoC-Claude] |
| `approval_requested` `{approvalRequestId, toolUseId?, toolName, actionKey, classification, summary, expiresAt}` | `canUseTool` pendente | [PoC-Claude] confinamento; pendência longa [Doc] |
| `interrupted` `{requestedBy:'user', forced}` | `result` com `error_during_execution` + flag local persistida | [PoC-Claude] T2 |
| `failed` `{code, retryable, attempt, message sanitizada}` | `result` com erro, classificado | formatos reais: [Não verificado] |
| `completed` `{resultSubtype:'success', durationMs}` | `result` success | [PoC-Claude] |
| `usage_updated` `{source: official\|estimate, windows?, costUsdEstimate?}` | `rate_limit_event` (oficial); `total_cost_usd` (estimativa) | [Doc]; `five_hour`/`seven_day` não encontrados |
| `error` `{code, fatal, detail}` | falhas de adapter/infraestrutura | n/a |

`completed` do runner significa **turno com sucesso**: a tarefa vai para `review`, não para `completed` (spec §5.9).

`ErrorCode`:
- tarefa: `AUTH_REQUIRED`, `SESSION_NOT_FOUND`, `USAGE_LIMITED`, `CREDITS_REQUIRED`, `TRANSIENT_OVERLOADED`, `TRANSIENT_NETWORK`, `MAX_TURNS`, `RUNNER_DIED`;
- infraestrutura: `RUNNER_SPAWN_FAILED`, `SESSION_ID_MISMATCH`, `SESSION_ID_IN_USE`, `LOCK_BUSY`, `LOCK_LOST`, `INVALID_TRANSITION`, `POLICY_DENIED`, `PROTOCOL_ERROR`, `UNKNOWN`.

O mapeamento desses códigos a partir do SDK **não foi verificado**; o runner falso usou strings inventadas.

Ordem de classificação do fim de uma execução:
1. Processo terminou sem `result` → `RUNNER_DIED` → `needs_reconcile`.
2. `success` → `completed` (tarefa vai a `review`).
3. Interrupção persistida + `error_during_execution` → `interrupted`.
4. `rate_limit_event` rejeitado ou `credits_required` → `usage_limited`.
5. Padrão de autenticação → `auth_error`.
6. Resume com id inexistente → `session_expired`.
7. Transitório → regra de retry (§5).
8. Demais → `failed`.

### 1.3 Operações

**start**
- Pré-condições: tarefa `queued`; slot global livre (MVP: uma tarefa ativa); `cwd` absoluto e registrado no projeto; `sessionId` UUIDv4 gerado pelo core, sem lock nem transcrito.
- Passos: (1) grava `session_reserved` no journal; (2) adquire lock do slot e da sessão; (3) relê o estado sob o lock; (4) `queued→running`; (5) spawn com `sessionId`, `cwd` e `canUseTool`, **sem `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`**; (6) espera o `init`; id diferente → `SESSION_ID_MISMATCH`, interrupt e `needs_reconcile`.
- Crash antes do passo 4: tarefa continua `queued`; lock abandonado é limpo; sessão reservada sem transcrito permite novo start. Crash depois: `running` sem lock → `needs_reconcile`.
- Idempotência: start repetido → `LOCK_BUSY` ou `INVALID_TRANSITION`. Um `sessionId` serve a um start; com transcrito existente → `SESSION_ID_IN_USE` (o caminho é o resume).

**interrupt**
- Pré-condição: `running` ou `awaiting_approval` com runner vivo deste processo; senão `not_running`.
- Passos: (1) grava `interrupt_requested` no journal (no PoC ficava em memória); (2) nega o `canUseTool` pendente com `interrupt:true`; (3) `query.interrupt()`; (4) espera `result` por `forceAfterMs` (proposta 10 s); (5) sem resposta: fecha stdin, mata a árvore → `forced_kill`.
- Pós: limpo → `interrupted` (ou `cancelled` com `reason=cancel`), lock liberado [PoC-Claude] T2, 43 ms. Forçado → `needs_reconcile`.
- Crash no meio: `running` sem lock → `needs_reconcile`; a evidência inclui `interrupt_requested`.
- Não verificado: kill da árvore (`/T`, Job Object).

**resume(sessionId, prompt explícito)**
- Pré-condições: tarefa em estado retomável (`interrupted`, `paused`, `needs_reconcile`, `usage_limited`, `auth_error`, `session_expired`) ou `review` (pedido de ajuste); `userGestureId` novo; prompt não vazio, mostrado e editável pelo usuário; em `needs_reconcile`, `reconcileAckId` e decisão por efeito não verificável (§3); em `session_expired`, só com `newSession:true` (novo id; o antigo é arquivado).
- Passos: lock; relê estado; `X→running` com `actor:user` e `gestureId`; spawn com `resume`, prompt explícito e sem `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`; `init` com o mesmo id; o `canUseTool` recebe a lista de actionKeys não confirmados (R6).
- Pós: o turno interrompido **não** é reexecutado pelo Claude Code: ele injeta "Continue from where you left off." sintético e o modelo decide a partir do prompt [PoC-Claude] T4, n=1.
- Idempotência: `userGestureId` repetido → no-op que devolve o `runId` atual; resume concorrente → `LOCK_BUSY` (o CLI não tem lock: T5).
- Não verificado: resume sem prompt; qual ramo vale após bifurcação.

**resolveApproval**
- Pré-condições: aprovação do `runId` vivo, HMAC válido (§4), não expirada e não consumida.
- Passos: grava a decisão no journal; responde `allow`/`deny` ao `canUseTool`. Com `allow`, grava a intenção no ledger **antes** de devolver.
- Crash: aprovação perdida (o `canUseTool` não sobrevive ao processo); tarefa → `needs_reconcile`; o efeito não ocorreu, pois não houve `allow`.
- Idempotência: consumo único (`already_consumed`) [PoC-falso] E/E2.

## 2. Máquinas de estado

Duas máquinas ligadas:
- **Tarefa:** persistida no journal; é o que a UI mostra.
- **Sessão:** derivada de lock, processo e transcrito; não editável pela UI.

Uma tarefa tem de 1 a N sessões ao longo do tempo (nova geração só em `session_expired`), no máximo uma ativa. Uma sessão pertence a uma tarefa.

### 2.1 Sessão

| Estado | Significado |
|---|---|
| `reserved` | id gerado e gravado, sem transcrito |
| `active` | lock vivo e runner deste core vivo |
| `idle` | sem processo; lock livre; retomável |
| `orphaned` | lock abandonado (pid_dead, pid_reused, heartbeat_stale) ou runner morto sem `result` |
| `expired` | resume recusado por id inexistente (retenção de 30 dias [Doc]) |
| `archived` | substituída ou de tarefa terminal |

Flag `externalActivity`: transcrito cresceu sem lock do Teracota (ex.: `claude --resume` em terminal). [Não verificado]

Invariantes na inicialização:
- I1: tarefa `running`/`awaiting_approval` ⇔ sessão `active`.
- I2: violação de I1 → tarefa `needs_reconcile`, sessão `idle` (lock removido se abandonado).
- I3: `session_expired` ⇔ sessão `expired`.
- I4: tarefa terminal ⇒ sessão `archived`, nunca retomada automaticamente.

### 2.2 Tarefa

Estados: `queued`, `running`, `awaiting_approval`, `paused`, `interrupted`, `needs_reconcile`, `review`, `completed`, `failed`, `cancelled`, `session_expired`, `auth_error`, `usage_limited`. `blocked` (spec) fica restrito a dependências no scheduler.

`paused` = parada limpa numa fronteira de turno, só para tarefas multi-turno. "Pausar fila" é flag do scheduler, não estado.

U = exige gesto explícito do usuário. A = automático. Δ = diferença em relação a `states.mjs`.

| De | Para | Gatilho | Quem |
|---|---|---|---|
| (nenhum) | queued | criar tarefa | U |
| queued | running | scheduler (política) ou "Iniciar" | política; padrão U |
| queued | cancelled | cancelar | U |
| queued | needs_reconcile | Δ: transcrito ou intenção existe | A |
| running | awaiting_approval | `canUseTool` destrutivo | A |
| running | paused | fronteira de turno com `pause_requested` | A após pedido U |
| running | interrupted | `error_during_execution` + `interrupt_requested` | A após pedido U |
| running | review | Δ: `result success` (no PoC ia a completed) | A |
| running | completed | Δ: só com critérios opt-in aprovados | A (opt-in) |
| running | failed | erro não transitório ou retries esgotados | A |
| running | cancelled | Δ: só com saída limpa (`result` recebido) | A após pedido U |
| running | needs_reconcile | runner morto sem `result`, kill forçado, `LOCK_LOST`, efeito não confirmado | A |
| running | session_expired / auth_error / usage_limited | classificação (§5) | A |
| awaiting_approval | running | aprovar ou negar | U |
| awaiting_approval | interrupted / cancelled | interromper ou cancelar | U |
| awaiting_approval | needs_reconcile | crash | A |
| paused | running / cancelled | retomar ou cancelar | U |
| interrupted | running | resume com prompt | U |
| interrupted | review | "o que foi feito basta" | U |
| interrupted | cancelled | cancelar | U |
| review | completed | aprovar | U |
| review | running | pedir ajuste (resume com prompt) | U |
| review | cancelled | cancelar | U |
| needs_reconcile | running | resume após evidência e decisões | U |
| needs_reconcile | review | Δ: substitui `needs_reconcile→completed` | U |
| needs_reconcile | failed / cancelled | decisão | U |
| session_expired | running | nova sessão (`newSession`) | U |
| session_expired | failed / cancelled | decisão | U |
| auth_error | running | após o usuário reautenticar fora do Teracota | U |
| auth_error | cancelled | cancelar | U |
| usage_limited | running / cancelled | decisão | U |

**Proibidas** (recusadas com `INVALID_TRANSITION`):
- qualquer `→running` sem gesto do usuário, exceto `queued→running` pela política;
- saída automática de `needs_reconcile`;
- `interrupted→failed`;
- sair de qualquer terminal;
- `running→queued`;
- `awaiting_approval→review/completed`;
- `session_expired→running` com o mesmo `sessionId`;
- `running→cancelled` sem saída limpa.

Cada transição grava `{seq, from, to, reason, actor, gestureId?, runId, evidence?}`.

## 3. Reconciliação após crash

**Regra-mãe:** nunca reexecutar automaticamente uma ação potencialmente já realizada. A reconciliação coleta evidência e muda estado para `needs_reconcile`.

Procedimento de inicialização, antes de liberar o scheduler:
- **R1.** Single-instance. Replay do journal; última linha truncada ignorada com aviso [PoC-falso] B/H3.
- **R2.** `running`/`awaiting_approval` com lock ativo: não mexe. Sem lock vivo: remove o lock abandonado e vai a `needs_reconcile` [PoC-falso] D.
- **R3.** Δ: `queued` com transcrito do seu `sessionId` ou intenção no ledger vai a `needs_reconcile` (`lost_transition`). Cobre perda da última linha do journal [Não verificado].
- **R4.** Runner órfão registrado (`runnerPid` + `startTime` batendo): encerra a árvore, vai a `needs_reconcile`. [Não verificado]
- **R5.** Evidência sem conteúdo:
  - últimos eventos do transcrito (turno incompleto termina em `tool_result` sem resposta, T3);
  - intenções não confirmadas, verificadas: arquivo com hash igual = aplicado; ausência confirmada = removido; Bash, git e rede = não verificável;
  - `git status`/diff resumido do `cwd`;
  - flags `interrupt_requested`/`cancel_requested`, motivo do lock, `externalActivity`.
- **R6.** Na retomada, o `canUseTool` nega qualquer tool call cujo actionKey seja de intenção não confirmada, salvo marcação do usuário "não aplicado". Ação destrutiva pede nova aprovação mesmo assim.

**Automático:** passar a `needs_reconcile`; remover lock abandonado; encerrar runner órfão do próprio journal; verificar efeitos verificáveis e montar sugestão.

**Exige o usuário:** Continuar (prompt editável; decisão por efeito não verificável: aplicado / não aplicado / não sei); Revisar; Marcar falha; Cancelar; iniciar tarefa `queued` com evidência; "Reiniciar" é sempre um clique, mesmo sem evidência.

Nunca usar `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`.

**Ledger de efeitos no Claude real** [Não verificado]: o core autoriza, o Claude executa.
- intenção = `allow` no `canUseTool`, com `actionKey = sha256(taskId | toolName | canonical(input))` e `toolUseId` se exposto;
- confirmação = `tool_result` do mesmo `toolUseId`.

## 4. Aprovação explícita de ações destrutivas

**Ações destrutivas (padrão):**
- Write, Edit ou NotebookEdit com caminho resolvido fora do workspace (realpath, symlink/junction, sem diferenciar maiúsculas no Windows). O `cwd` não confina a escrita (incidente do T3, tentativa 1).
- Remoção: `rm`, `del`, `Remove-Item`, `rmdir`, `git clean`, `git reset --hard`, `git checkout --`/`restore` sobre alterações, apagar branch.
- `git commit`, `git push` (incl. `--force`), `git tag`.
- Release: `gh release`, `npm publish` e equivalentes.
- Deploy: padrões configuráveis.
- Bash com composição (`&&`, `;`, `|`, `$(...)`) ou fora da allowlist. Padrões destrutivos pedem aprovação mesmo com prefixo permitido.
- Escrita dentro do workspace: depende da política (§9, item 3).

**Registro:** `approvals` append-only, fora do workspace. Campos: `{approvalId, approvalRequestId, taskId, sessionId, runId, toolUseId?, actionKey, classification, summaryShown, decision, actor:'user', gestureId, decidedAt, expiresAt}` e um `hmac` com chave gerada em memória a cada inicialização do core, **nunca persistida**. Só o caminho de comando da UI (gesto do usuário) grava aprovação; runner e agente não gravam.

**Escopo:** uma ação (actionKey + toolUseId), uma vez; consumida no primeiro uso; repetição → `already_consumed`. Sem "sempre permitir" no MVP.

**Expiração:** TTL proposto de 10 min; fim do `runId`; perda do lock (nonce); reinicialização do core (a chave HMAC muda). Expirada → `deny` ao Claude e novo `approval_requested` se tentar de novo.

**Fencing:** antes de cada `allow`, o core confere o nonce do lock; se perdeu: `deny`, interrupt e `LOCK_LOST`.

**Alternativa (não MVP):** `PreToolUse` com `defer` — sobrevive a crash, mas só com `-p` e uma tool por turno [Doc].

## 5. Sessão expirada, autenticação e limite de uso

| Caso | Detecção | Estado | UI | Não fazer |
|---|---|---|---|---|
| Sessão expirada | resume com id inexistente (formato [Não verificado]) | `session_expired` | "A sessão anterior não existe mais. Iniciar nova? O contexto será perdido." | recriar em silêncio; reutilizar o id; montar contexto do transcrito sem o usuário ver |
| Autenticação | erro de auth (formato [Não verificado]); sem ler credenciais | `auth_error`; scheduler para | "O Claude Code não está autenticado. Faça login no `claude` oficial num terminal." + "Tentar de novo" (U) | campo de login ou token; ler `~/.claude`; API key ou conta de terceiros; trocar de conta; retry automático |
| Limite de uso | `rate_limit_event` rejeitado ou `credits_required` [Doc]. HTTP 429 de `api_retry` **não** é limite de assinatura | `usage_limited`; scheduler para | "Limite atingido (fonte oficial)" com `resetsAt` só se informado; sem fonte: "indisponível", nunca 0% | contornar; trocar para API key ou outra conta; retomar sozinho no reset; inferir reset; retry em loop |
| Transitório | `overloaded`/rede | `running` durante retry | "Tentando de novo (n/3)" | retry infinito |

**Retry:**
- só transitórios; backoff exponencial (base 1 s); no máximo 3 retries, depois `failed(retries_exhausted)` [PoC-falso] G2;
- só se a tentativa não teve tool_use autorizado; senão `needs_reconcile`;
- o CLI já faz retries internos (`api_retry` [Doc]); o do core é externo;
- auth, sessão e limite: zero retries.

## 6. Lock e persistência

**Mecanismo testado** [PoC-falso], `lib/lock.mjs`:
- `locks/<sessionId>.lock` criado com `open(wx)`; conteúdo `{pid, startedAt, hostId, nonce, heartbeat}`, com fsync.
- heartbeat a cada 5 s por tmp+rename.
- abandono, nesta ordem: pid morto; pid reutilizado (só com divergência positiva de `startedAt`; consulta desconhecida não prova reuso — bug corrigido); heartbeat com mais de 30 s; lock corrompido com mais de 30 s.
- tomada serializada por guard `.takeover` (expira em 10 s); o dono antigo detecta `lost` pelo nonce e não apaga o lock do novo.
- journal JSONL com fsync por linha e tolerância à última linha truncada.
- passaram: A(a–d), A(hb), A(lost), B, B2, C, D, H3, H4.

**Lacunas:**
1. Reuso real de PID não provocado (só simulado).
2. Windows sem fsync de diretório: criação e rename podem não ser duráveis após queda de energia. Mitigação: R3.
3. Tempo de criação do processo obtido por PowerShell (300–800 ms; falha sob carga). Usar `GetProcessTimes`.
4. Heartbeat vencido com processo vivo (event loop bloqueado > 30 s) abre janela de dois donos. Mitigação: fencing por nonce antes de cada `allow`.
5. Corrida em `beat()` entre ler o nonce e o rename. [Não testado]
6. Guard de takeover atrasa a tomada em até 10 s.
7. `seq` do journal só é seguro com escritor único (o core).
8. `claude --resume` externo escapa ao lock; só detectável (`externalActivity`).
9. Efeitos verificados só com arquivos; git, remoto e Claude real não testados.

**Proposta para o host Rust** (decisão do usuário): lock do SO (LockFileEx/flock) mantido aberto pela vida do processo, mais metadados em JSON só para diagnóstico — elimina as lacunas 1, 4 e 5. Mais Job Object com `KILL_ON_JOB_CLOSE`, para que a morte do host mate o `claude`. Ambos não verificados.

## 7. Resumo de verificação

- **[PoC-Claude]:** id no init (T1); interrupt 43 ms com sessão reutilizável (T2); transcrito até o `tool_result`, deltas perdidos, filho morre (T3); resume sem reexecução automática (T4); CLI sem lock (T5); sem duplicação com crash após o `tool_result` (T6); `cwd` não confina escrita.
- **[PoC-falso]:** lock, journal, transições, reconciliação, aprovação de uso único, efeitos F1–F4, retry G2, H1–H5.
- **[Doc]:** `sessionId`, `rate_limit_event`, `defer`, `api_retry`, retenção de 30 dias, conformidade de auth.
- **[Não verificado]:** formatos reais de auth, expiração e limite; `sessionId` escolhido pelo host; ledger com `toolUseId`; crash entre efeito e `tool_result`; kill da árvore e Job Object; sidecar no Tauri; ramo vencedor após T5; `externalActivity`.

## 8. Critérios para a Fase 3 (verificáveis)

- Todo `→running` que não seja `queued→running` tem `actor:user` e `gestureId` no journal.
- Kill do runner durante Write: nenhuma reexecução sem gesto; tool call repetida negada pelo R6.
- Mapeamento real de `AUTH_REQUIRED`, `SESSION_NOT_FOUND` e `USAGE_LIMITED` com evidência, ou marcado "indisponível".
- Zero processos `claude` órfãos após 5 kills do host.
- Aprovação de `runId` anterior recusada após reinicialização.

## 9. Decisões que exigem aprovação do usuário

1. **Divergências da spec §3.2:** `start` recebe o `sessionId`; `resume` exige prompt; eventos `interrupted` e `error` no lugar de `stopped`; novos estados `needs_reconcile`, `interrupted`, `session_expired`, `auth_error`, `usage_limited`; `usage_limited` no lugar de `paused`/`blocked` da §5.8; `blocked` só para dependências.
2. **Fim de turno e cancelamento:** `success` leva a `review`; remover `needs_reconcile→completed` e `running→cancelled` direto; `running→completed` só com critérios opt-in.
3. **Política de escrita e Bash:** escrita dentro do workspace livre (proposta) ou com aprovação (leitura literal da spec §3.4); Bash por allowlist com aprovação para o resto (proposta). Pendência: a spec fala em "comandos de escrita" e o brief em "escrita fora do workspace".
4. **Aprovação:** TTL de 10 min; sem "sempre permitir" no MVP.
5. **Interrupt:** `forceAfterMs` de 10 s.
6. **Retry:** 3 retries (4 execuções, como no PoC) ou 3 execuções no total; só antes de qualquer tool_use.
7. **Persistência:** SQLite (WAL, `synchronous=FULL`) ou JSONL com fsync.
8. **Lock:** lock do SO mais Job Object no Rust, ou port do PoC.
9. **Mecanismo de aprovação:** `canUseTool` (MVP) ou `defer`.
10. **Mapear erros reais com o Claude:** consome sessões da franquia; o teste de auth exige logout e login feitos pelo próprio usuário; limite de uso não é provocado, só observado quando ocorrer.
11. **Autoexecução de `queued→running`:** padrão manual.
12. **Conformidade:** sem distribuição com login de assinatura; para terceiros, API key gerida pelo usuário ou consulta prévia à Anthropic.
