# Fase 0.5 - Frente B: segurança do runner (resultados)

Código: `poc/runner-safety/` (`npm test` ou `node --test --test-concurrency=1`; cenários de crash: `node scripts/crash-scenarios.mjs`).
Ambiente: Node 24.19, Windows 11, tudo com **runner FALSO** (`fake-runner.mjs`) e processos reais para os kills. **O Claude real NÃO foi chamado** (0 de 3 sessões usadas).
Última execução: 29 testes, 29 passaram, 0 falharam (`evidence-test-run.txt`). Log dos cenários de crash: `evidence-crash-scenarios.log`.
Legenda: VERIFICADO = coberto por teste automatizado com runner falso/processos reais. Nada aqui é "MEDIDO" contra o Claude real.

## Defeito encontrado durante o trabalho
Na 1ª execução, A(a) falhou (4 vencedores em vez de 1). Causa provável (inferida, não isolada por instrumentação): a consulta ao tempo de criação do processo (PowerShell) falhou/retornou vazio sob carga com 6 processos, e `null !== startedAt` era interpretado como "PID reutilizado", removendo um lock vivo. Correção: só uma divergência POSITIVA (ambos conhecidos e diferentes) conta como PID reutilizado; lookup desconhecido cai na regra do heartbeat. Teste de regressão adicionado; A(a) rodou 4 vezes depois (3 isoladas + suíte) com 1 vencedor. Ainda é n pequeno.

## Tabela por cenário

| Id | Hipótese | Procedimento | Resultado | Evidência | Status |
|---|---|---|---|---|---|
| A(a) | 2+ processos no mesmo lock: exatamente 1 vence | 6 processos com barreira de tempo, `open(wx)` em `locks/<id>.lock` | 1 ok, 5 `active` (ou recusados) | `test/lock.test.mjs` A(a); linha `A(a) results` | VERIFICADO (runner falso) |
| A(b) | Lock de processo morto (kill -9) é assumido | worker segura o lock, `SIGKILL`, outro `acquireLock` | `tookOver.reason=pid_dead`; lock passa ao novo pid | lock.test A(b); S4 no log | VERIFICADO |
| A(c) | PID reutilizado é detectado | lock forjado com PID vivo e `startedAt` diferente | `pid_reused`, assumido | lock.test A(c) | VERIFICADO (simulado; reuso real de PID não foi provocado) |
| A(d) | Lock ativo com heartbeat recente é recusado, nunca removido | `acquireLock` duplicado + 4 processos martelando durante heartbeats de 100 ms | todos `active`; nonce do lock inalterado | lock.test A(d) | VERIFICADO |
| A(hb) | Heartbeat atômico (tmp+rename); >30 s = abandonado | heartbeat 50 ms; `evaluateLock` com `now`+29 s / +31 s | muda; sem `.tmp` remanescente; 29 s ativo, 31 s `heartbeat_stale` | lock.test heartbeat | VERIFICADO (30 s simulado via relógio injetado, não esperado de verdade) |
| A(lost) | Holder antigo percebe que perdeu o lock e não apaga o do novo | unlink + novo acquire; `beat()`/`release()` do antigo | `lost=true`; lock do novo preservado | lock.test | VERIFICADO |
| B | Última linha truncada é ignorada com aviso, anteriores preservadas | truncar a última linha em CADA offset de byte | estado anterior sempre correto; aviso emitido | journal.test B | VERIFICADO |
| B2 | Append após linha truncada não corrompe | `__partial` (meia linha sem `\n`) e novo append | fragmento fica isolado em linha própria, 1 aviso, estado correto | journal.test B2 | VERIFICADO |
| C | Transições inválidas recusadas | todas as combinações estado x estado vs tabela; sequência real no journal | todas as fora da tabela recusadas (`InvalidTransitionError`); terminais sem saída; `interrupted` não vai a `failed` | journal.test C | VERIFICADO |
| D | Crash: running sem lock ativo -> needs_reconcile, sem reexecutar | orquestrador (processo) morto com `SIGKILL`; novo orquestrador chama `reconcileOnStartup()` | `needs_reconcile (orchestrator_crash(lock=pid_dead))`, evidência = último evento do transcrito + efeitos pendentes (`targetExists`), `hasUnconfirmedEffects=true`; transcrito não cresce; 2ª chamada é no-op; lock obsoleto removido | integration.test D; S2 | VERIFICADO |
| D2 | Tarefa com lock vivo não é tocada | reconcile com outro orquestrador vivo | `[]`, continua `running` | integration.test D2 | VERIFICADO |
| E | Ação destrutiva exige aprovação explícita, uso único | `rm` destrutivo: sem aprovação; aprovação de outro id (via CLI separada `approve`); aprovação correta; repetição | `awaiting_approval` + recusa; recusa; executa 1x (volta a `running`); repetição recusada (`already_confirmed`) | effects.test E, E2 (aprovação presa a task+step+ação) | VERIFICADO |
| F1 | Crash após efeito, antes da confirmação: verificável não duplica | exceção após `write_file`; sem "Continuar" -> recusa/`needs_reconcile`; com "Continuar" | confirma por verificação (`verified_already_applied`), sem reescrever (mtime igual) | effects.test F1 | VERIFICADO |
| F2 | Efeito verificável que NÃO aplicou é executado 1x no Continuar | crash após intent | executa uma vez | effects.test F2 | VERIFICADO |
| F3 | Efeito NÃO verificável -> needs_reconcile, nunca reexecuta | crash após `remote_call`; Continuar | `unconfirmed_effect_not_verifiable`, `hasUnconfirmedEffects=true`; log remoto com 1 linha | effects.test F3 | VERIFICADO |
| F4 | Idem com SIGKILL real entre efeito e confirmação | processo filho com `--crash-after-exec` | efeito no disco, journal de efeitos só com `intent` | effects.test F4 | VERIFICADO |
| G | auth/expired/usage = estados próprios, sem retry | cenários do runner falso | `auth_error`, `session_expired`, `usage_limited`; 1 só execução cada, 0 retries | integration.test G | VERIFICADO (erros SIMULADOS) |
| G2 | Transitório: backoff exponencial, máx 3 retries | `overloaded` sempre | delays 20/40/80 ms (base configurável; padrão 1000 ms), 4 execuções, depois `failed(retries_exhausted)`; recuperação após 2 falhas -> `completed` | integration.test G2 | VERIFICADO |
| H1 | Interrupção -> `interrupted` | `interrupt` via stdin ao runner falso | `interrupted`/`user_interrupt` (distinto de failed), lock liberado | integration.test H1 | VERIFICADO (a distinção depende de flag local, como no PoC anterior) |
| H2 | SIGKILL do runner -> reconciliação | `process.kill(runnerPid,'SIGKILL')` | `needs_reconcile (runner_died)`, 1 só `runner_started`, transcrito estável | integration.test H2; S1 | VERIFICADO |
| H3 | Crash do orquestrador no meio de uma transição -> journal consistente | processo grava meia linha e se mata | estado anterior (`running`), aviso "truncated", novo append correto | journal.test H3; S3 | VERIFICADO |
| H4 | 2 orquestradores na mesma sessão: um recusado | 2 processos com barreira | 1 `started`, outro `LockBusyError: active`; 1 só transição para `running` | integration.test H4 | VERIFICADO |
| H5 | Retomada explícita após reconcile: novo run, novo lock | `start` sem `userResume` é recusado e não deixa lock; com `userResume` | roda com `--resume`, transcrito continua, `completed` | integration.test H5 | VERIFICADO |

## Depende do Claude real (NÃO TESTADO)
| Item | Razão |
|---|---|
| Formato real dos erros de auth / sessão expirada / limite de uso e se são distinguíveis do erro genérico | runner falso usa strings inventadas (`authentication_failed`, `session_not_found`, `usage_limit_reached`, `overloaded`); mapear contra o SDK exige provocá-los de verdade |
| `resume` real de uma sessão que estava com lock abandonado (ramificação no JSONL) | só o PoC anterior (n=1) cobre; o lock evita o caso, mas não foi exercitado com o `claude` |
| Retomada real de turno interrompido (o PoC anterior mostrou que não re-executa sozinho) | depende do Claude |
| Que o `claude` filho morre quando o pai morre | no PoC anterior era "provável"; aqui o runner FALSO foi desenhado para fazê-lo (stdin end) |
| Teste de integração final com 1-3 sessões haiku | não executado (decisão de manter o escopo ao runner falso) |

## Limitações
- **fsync no Windows**: `fsync` de arquivo usa FlushFileBuffers; não há fsync de diretório, então a criação/rename do arquivo pode não ser durável após queda de energia (só testamos kill de processo, não falta de energia/kernel panic).
- **Tempo de criação do processo** vem de PowerShell (`Get-Process`), ~300-800 ms por consulta e pode falhar sob carga (causou o defeito acima). Em produção usar chamada nativa/cache; lookup desconhecido nunca prova reuso.
- **Reuso de PID** só foi simulado (lock forjado); `startedAt` tem resolução de 100 ns no Windows, mas em Linux `ps lstart` tem resolução de 1 s (não testado em Linux/macOS).
- **Heartbeat obsoleto com processo vivo** (>30 s, ex.: event loop bloqueado) é tratado como abandonado, então o processo antigo pode seguir rodando em paralelo; ele só percebe no próximo heartbeat. Janela de duplo-dono inevitável sem fencing no runner.
- **Guard de takeover** (`.takeover`, expira por mtime de 10 s) e arquivo de lock vazio (criado e não escrito) usam heurística de tempo; um guard órfão atrasa a tomada até 10 s.
- **Journal single-writer por tarefa**: `seq` é lido-e-incrementado sem lock de arquivo; seguro só porque o lock da sessão garante um único escritor por tarefa. Dois escritores no mesmo `taskId` podem duplicar `seq`.
- **Verificação de efeito** é por conteúdo/ausência de arquivo; `git push`/`commit`/chamadas remotas foram modelados como `remote_call` não verificável (escrita em log local), nunca contra um git real.
- Aprovação é um arquivo local sem assinatura: quem escreve no diretório pode aprovar. Não há proteção contra um agente com acesso ao disco.
- Kill no Windows: `process.kill(pid,'SIGKILL')` aparece como `code=1, signal=null` (não `SIGKILL`); detecção usa a ausência de linha `result`, não o sinal.
- Retry: "3 tentativas" foi interpretado como 3 retries (4 execuções); mudar `maxRetries` se a regra for 3 execuções no total.
- Tamanhos amostrais: cada cenário de crash foi rodado poucas vezes (n pequeno); corridas de concorrência (A(a), H4) podem ter falhas raras não observadas.
