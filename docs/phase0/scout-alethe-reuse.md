# Reaproveitamento do Alethe (Scout, Fase 0) — parcial

## 1. Licença
- `K:\dev\alethe-agents\LICENSE`: AGPL-3.0. `package.json:4` declara `AGPL-3.0-or-later`.
- Copiar código ou criar derivado obriga a licença AGPL no Teracota (MIT), incluindo a cláusula de rede.
- **Recomendação:** reimplementar a partir de conceitos, sem copiar código. Consequências jurídicas: verificar com advogado.

## 2. Núcleo TS puro (sem I/O)
- `src/lib/agentTasks/taskStateMachine.ts:9-17` (transições), `:36-55` (prioridade e FIFO).
- `src/lib/agentTasks/taskDependencies.ts:6-61` (DAG, detecção de ciclo, bloqueios).
- `src/lib/agentTasks/taskScheduler.ts:20-41` (seleção gulosa).
- `src/lib/agentTasks/workers.ts:12-62` (pool derivado das tarefas, sem persistência).

## 3. Scheduler em Rust (acoplado a estado global)
- `src-tauri/src/scheduler.rs:97-128` (Scheduler, OnceLock), `:150-169` (allowed_transition), `:285-472` (tick: Pending→Ready, Ready→Running com lease, Running→Review/Completed), `:688-790` (set_task_status), `:796-802` (hydrate), `:804-830` (event loop).
- O tick não aplica limite de concorrência.

## 4. Orquestrador de workers (pool Codex)
- `src-tauri/src/orchestrator_core.rs:18-27` (limite padrão 4; estados queued/running/done/failed/cancelled/released), `:135-144`, `:237-238` (limite 1–16), `:258-368` (spawn), `:528` (drain_queue).
- Pool de workers Codex via JSON-RPC, em memória, sem DAG.

## 5. Testes
- Existem `taskStateMachine.test.ts`, `taskScheduler.test.ts`, `taskDependencies.test.ts`, `workers.test.ts`, e testes Rust em `scheduler.rs:832-1300`.
- Contagem de casos e cobertura: NÃO VERIFICADO.
- **Recuperação após crash: nenhum código nem teste encontrado** (grep de crash/recover/restart/reconcil/stale/orphan: zero). `hydrate` não reseta leases de tarefas que estavam em Running. **Lacuna a fechar no Teracota.**

## 6. Não verificado
Contagem de linhas do núcleo TS; acoplamento a React/Tauri nos stores (`schedulerStore.ts`, `projectsStore.agentTaskSlices.ts`) e a `supervisor.rs`/`worktrees.rs`; retries (não encontrados); aprovação/gate além de Review→Completed; logs e eventos (`event_bus`, `agent_events.rs` não lidos); dependências de runtime do núcleo.

## 7. Recomendação
- **Reimplementar:** máquina de estados (transições de `taskStateMachine.ts`), ordenação por prioridade+FIFO, checagem de dependências com detecção de ciclo, pool de concorrência de 1 por agente.
- **Só referência:** o tick e os testes Rust.
- **Descartar:** pool Codex de `orchestrator_core.rs`, tick acoplado a worktrees/supervisor, stores React.
- **Adicionar:** recuperação de crash (tarefa em running com lease órfã), que o Alethe não tem.
