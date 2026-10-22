# PoC Runner (Fase 0) - resultados

Código: `poc/pocket-runner/` (`runner.mjs` roda uma sessão via Agent SDK; `crash-driver.mjs` mata o processo pai com `taskkill /F /PID`; `inspect-jsonl.mjs` resume o transcript sem imprimir conteúdo). Logs em `poc/pocket-runner/out/`.
Ambiente: SDK 0.3.289 (reaproveitado de `K:\dev\waifu-claude\poc\claude-gui\node_modules`, nada instalado), `claude` 2.1.224, modelo `haiku`, Windows 11. Permissões via `canUseTool` (só Read/Write dentro de `workspace\`), Bash desabilitado. Sessões usadas: 7 (T1, T2, T3 x2, T4, T5 x2).
Observação: os tempos incluem o startup dos hooks do usuário (~5s até o primeiro evento) e variam entre execuções (n=1 por teste).

## T1 - Início de tarefa e session_id
| Hipótese | Procedimento | Resultado observado | Evidência | Status |
|---|---|---|---|---|
| O session_id é conhecido antes da primeira resposta | `query()` com prompt "Diga apenas: ola.", capturar `system/init` e o 1º `text_delta` | init em t=9860 ms (~5s só para os primeiros eventos de hook); 1º text_delta em t=12329 ms; session_id idêntico nos dois (`8c0c107f...`). O id chega ~2,5s antes do 1º delta | `out/T1.jsonl` | CONFIRMADO |

## T2 - Interrupção
| Hipótese | Procedimento | Resultado observado | Evidência | Status |
|---|---|---|---|---|
| `interrupt()` para a tarefa rápido e a sessão continua utilizável | Listar 1-300 por extenso; `interrupt()` ao 5º text_delta; depois 2ª mensagem "Diga apenas: pronto." na mesma query | `interrupt()` retornou em 43 ms. O stream emitiu `user` e um `result` com `subtype=error_during_execution`, `is_error=true`, `errors=["[ede_diagnostic] result_type=user ... stop_reason=null"]` (~10 ms depois). A 2ª mensagem foi aceita na mesma sessão (mesmo session_id, novo `init`) e terminou com `success` ("Pronto."). Atenção: os 5 deltas chegaram em rajada (~2 ms após o 1º), então a interrupção ocorreu logo no início da geração | `out/T2.jsonl` | CONFIRMADO |
| O resultado de interrupção é distinguível de erro real | - | O tipo é `error_during_execution`/`is_error=true`, rótulo genérico de erro; a GUI deve marcar "interrompido pelo usuário" por flag local. Outros erros não foram testados para comparar | `out/T2.jsonl` | INCONCLUSIVO |

## T3 - Crash do processo pai
| Hipótese | Procedimento | Resultado observado | Evidência | Status |
|---|---|---|---|---|
| (a) O transcript existe após kill -9 equivalente | Tarefa: Write de `T3-a.txt` e depois listar 1-300; `taskkill /F /PID` do runner ao 5º text_delta | Existe `~/.claude/projects/K--dev-waifu-claude-pocket-poc-pocket-runner-workspace/505a109c-....jsonl` (30 015 bytes) | `out/T3.transcript-summary.txt` | CONFIRMADO |
| (b) Linhas e tipos gravados | Leitura do JSONL por script | 15 linhas: queue-operation x2, attachment x6, user (prompt), file-history-snapshot, assistant(thinking), assistant(tool_use Write), file-history-delta, user(tool_result) | idem | CONFIRMADO |
| (c) O último evento é turno incompleto | idem | Último evento de conversa = `user/tool_result` do Write; NÃO há assistant text nem resultado. Os 5 deltas já recebidos pelo cliente não foram persistidos (a mensagem em geração só é gravada ao completar). Turno incompleto = termina em tool_result sem resposta | idem | CONFIRMADO |
| O `claude` filho morre junto com o pai | PID filho capturado antes do kill; checagem 5s depois | Filho (PID 19752) não estava vivo 5s depois. Fechamento do stdin é a causa provável (não verificada isoladamente) | `out/T3.kill.json` | CONFIRMADO (efeito); causa INCONCLUSIVA |
| Efeito colateral do Write sobreviveu | `ls workspace` | `T3-a.txt` com conteúdo "a" existe | `workspace/T3-a.txt` | CONFIRMADO |

Tentativa 1 descartada (`out/attempt1-discarded/`): com `acceptEdits` e prompt sem caminho absoluto, o modelo gravou `T3-a.txt` em `K:\dev\` (fora do workspace); o arquivo foi removido por mim e passei a bloquear escrita fora de `workspace\` via `canUseTool` e caminhos absolutos. Lição: `cwd` não confina escrita; o confinamento exige `canUseTool`/hook. Nessa tentativa o kill chegou depois do fim do turno (latência do powershell antes do kill), por isso foi refeita.

## T4 - Retomada após crash
| Hipótese | Procedimento | Resultado observado | Evidência | Status |
|---|---|---|---|---|
| `resume=<id>` abre um transcript que acabou em tool_result sem erro | Novo processo com `resume` e "Continue de onde parou ou diga que não há o que continuar" | Sem erro. init em 11,4s, 1º delta em 14,0s, result `success` em 36,4s (378 deltas). Mesmo session_id (sem fork) | `out/T4.jsonl` | CONFIRMADO |
| O turno interrompido é re-executado automaticamente | Inspecionar o transcript | NÃO. O Claude Code injetou um par sintético (`user isMeta "Continue from where you left off."` + `assistant <synthetic> "No response requested."`), sem chamar o modelo. Quem retomou o trabalho foi o modelo, por causa do prompt do usuário: respondeu "Continuando: escrever os números de 1 a 300" e listou. O turno ficou pendente; a continuação depende do prompt, a GUI não deve esperar re-execução automática | `out/T4.transcript-summary.txt` (linhas 16-19), `out/T4.jsonl` | CONFIRMADO (n=1) |
| Retomar sem prompt do usuário se comporta igual | - | Não testado | - | INCONCLUSIVO |

## T5 - Concorrência de retomada
| Hipótese | Procedimento | Resultado observado | Evidência | Status |
|---|---|---|---|---|
| Existe lock que impede duas retomadas simultâneas da mesma session_id | Dois processos `resume` da mesma sessão (`d993abc9...`), prompts "Diga apenas: A" / "B", disparados juntos | Não há lock: nenhum falhou; ambos `success` ("A" e "B"), sem erro, init com ~80 ms de diferença | `out/T5A.jsonl`, `out/T5B.jsonl` | REFUTADO |
| As mensagens se intercalam no mesmo arquivo | Análise de uuid/parentUuid do JSONL (20 -> 41 linhas) | Sim, no nível de linha: os dois turnos foram anexados ao mesmo arquivo, intercalados (user B, user A, assistant B, assistant A). Cada processo montou o contexto a partir do mesmo pai (`d20fe8`), criando dois ramos divergentes; cada resposta não enxerga a outra. Corrupção de JSON não observada (todas as linhas parseiam) | `out/T5.chain.txt`, `out/T5.transcript-summary.txt` | CONFIRMADO |
| Qual ramo vale numa retomada posterior | - | Não testado | - | INCONCLUSIVO |

Implicação: o lock de retomada precisa ser implementado pelo Teracota (ex.: lockfile por session_id); o CLI/SDK não o fornece.

## T6 - Duplicação de escrita
| Hipótese | Procedimento | Resultado observado | Evidência | Status |
|---|---|---|---|---|
| A retomada duplica a ação de escrita | Antes: 1 tool_use Write no transcript e 1 arquivo no workspace (mtime 21:27:17). Depois de T4: contagem repetida | Continua 1 tool_use Write, 1 arquivo, mtime e conteúdo inalterados. Sem duplicação (o Write já tinha tool_result gravado) | `out/T4.transcript-summary.txt`, `workspace/` | REFUTADO (neste cenário) |
| Duplicação se o crash ocorrer entre o efeito e o tool_result | - | Não testado (exigiria matar durante o Write; janela estreita) | - | INCONCLUSIVO |

## Limitações e o que não foi verificado
- n=1 por teste, modelo haiku, Windows; tempos dominados pelos hooks do usuário e pela latência da API.
- O kill foi só do processo pai (sem `/T`); não testado kill do `claude` filho, nem queda de energia/flush parcial.
- Não testado: crash durante a escrita, retomada sem prompt, ramo vencedor após T5, crash com `canUseTool` pendente, `forkSession`, turnos longos concorrentes.
- A perda dos deltas após o crash foi inferida do transcript, não do buffer do processo.
- Eventos `system/hook_*` vêm dos hooks globais do usuário; em outra máquina os tempos de init serão menores.
- Nada em `src/` alterado; nenhuma config global tocada. Transcripts de teste permanecem em `~/.claude/projects/K--dev-waifu-claude-pocket-poc-pocket-runner-workspace/` (não removidos).
