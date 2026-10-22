# Tera Pocket — Fase 0: matriz de viabilidade de capacidades

Legenda de status: **VERIFICADO** = medido com evidência neste PoC · **PARCIAL** = verificado com ressalva · **DOCUMENTAÇÃO** = confirmado só pela documentação oficial · **NÃO VERIFICADO** = sem evidência · **NÃO SUPORTADO** = a plataforma não oferece.

## A. Janela e interação (Electron atual × Tauri v2 no Windows)

| # | Capacidade | Electron (atual) | Tauri v2 | Status Tauri | Evidência / observação |
|---|---|---|---|---|---|
| A1 | Janela transparente sem moldura | Sim (`transparent`, `frame:false`) | Sim (`transparent`, `decorations:false`) | VERIFICADO | PoC T1: 0/100800 pixels fora do retângulo diferem |
| A2 | Sempre no topo | Sim, nível `screen-saver` | Sim, sem nível | PARCIAL | PoC T6 sobre janela maximizada; acima de tela cheia NÃO VERIFICADO |
| A3 | Fora da barra de tarefas | Sim | Sim (`skipTaskbar`) | DOCUMENTAÇÃO + PoC T5 | — |
| A4 | Não roubar foco | Sim (`showInactive`) | Sim (`focus:false`) | VERIFICADO (2 execuções) | PoC T5 |
| A5 | Click-through alternado (por janela) | Sim, `forward:true` | Sim, `set_ignore_cursor_events` sem `forward` | VERIFICADO (emulado) | T2/T3: latência 22–29 ms; 200+ alternâncias sem artefato |
| A6 | Click-through por pixel de alfa | Sim (polling + máscara alfa no renderer) | Não há nativo; exige portar a máscara | NÃO VERIFICADO | Hoje o PoC usa retângulo |
| A7 | Estabilidade ao alternar cursor events | Sem issue conhecida | Issue #15947 **aberta** (Win10, transparência) | PARCIAL | Não reproduziu em 1 GPU, ~30 s; sem teste de longa duração |
| A8 | Arrasto da janela | `setBounds` por deltas via IPC | `data-tauri-drag-region` + capability; não funciona com ignore=true | PARCIAL | T7: delta exato inconclusivo (mouse sintético) |
| A9 | Posição em monitores com coordenadas negativas | Sim | Sim (`set_position`) | VERIFICADO | T8: (-2400,0) e (-200,200) aplicados |
| A10 | DPI misto entre monitores | Ponto frágil documentado (`entity.ts:94-96`) | Não testado | NÃO VERIFICADO | Ambos os monitores a 100% |
| A11 | Tray com menu e clique | Sim | Plugin oficial | DOCUMENTAÇÃO | Comportamento não testado |
| A12 | Single-instance | Sim | Plugin oficial | DOCUMENTAÇÃO | Não testado |
| A13 | Autostart | Sim (`setLoginItemSettings`) | Plugin oficial | DOCUMENTAÇÃO | Não testado |
| A14 | Visível em todos os espaços | Sim | **NÃO SUPORTADO** no Windows | NÃO SUPORTADO | Docs docs.rs: "Unsupported on Windows" |
| A15 | Janela sobre tela cheia exclusiva | Sim (`screen-saver`) | NÃO VERIFICADO | NÃO VERIFICADO | — |
| A16 | Drop de arquivos HTML5 | Sim | Exige `drag_drop_enabled:false` no Windows | DOCUMENTAÇÃO | Relevante para o Pocket |
| A17 | Sombra | Sem sombra | `shadow` sem efeito em janela decorada | DOCUMENTAÇÃO | — |

## B. Desempenho e recursos

| # | Métrica | Electron | Tauri | Status | Observação |
|---|---|---|---|---|---|
| B1 | Memória em repouso | Não medido no mesmo harness | ~323 MB (24,5 MB app + 298,6 MB WebView2) | PARCIAL | n=1; WorkingSet conta páginas compartilhadas |
| B2 | Cold start | Não medido | 1,4–2,8 s até o canal responder | PARCIAL | Não é "primeiro frame" |
| B3 | Tamanho do executável | — | ~7,3 MB | VERIFICADO | — |
| B4 | CPU em repouso | Ver `poc/claude-gui` e histórico | Não medido | NÃO VERIFICADO | — |

## C. Runner (Claude Code CLI / Agent SDK)

| # | Capacidade | Status | Evidência |
|---|---|---|---|
| C1 | Saída estruturada (`stream-json`) | DOCUMENTAÇÃO | headless.md (Scout) |
| C2 | `session_id` antes da 1ª resposta | VERIFICADO | Runner T1: ~2,5 s antes do 1º delta |
| C3 | `session_id` escolhido pelo host (`sessionId`) | DOCUMENTAÇÃO | typescript ~514 (não testado no PoC) |
| C4 | Interromper execução | VERIFICADO | Runner T2: 43 ms; sessão segue utilizável |
| C5 | Interrupção distinguível de erro | **NÃO SUPORTADO** pelo resultado | Ambas viram `error_during_execution`; exige flag local |
| C6 | Retomar sessão após reinício | VERIFICADO | Runner T4 |
| C7 | Turno interrompido re-executado sozinho | **REFUTADO** | Runner T4: entra prompt sintético |
| C8 | Lock de retomada (uma sessão, um dono) | **REFUTADO** (inexistente) | Runner T5: ramos divergentes no JSONL |
| C9 | Persistência do transcript após SIGKILL | PARCIAL | Runner T3: até o `tool_result`; texto não entregue se perde |
| C10 | Duplicação de escrita após crash | VERIFICADO sem duplicação (1 caso) | Runner T6; crash entre efeito e `tool_result` NÃO testado |
| C11 | Aprovação pendente sobrevive a reinício | **NÃO SUPORTADO** | Scout F; `defer` só em `-p`, uma tool por turno |
| C12 | Dados oficiais de limite de uso | PARCIAL | `rate_limit_event` oficial; `five_hour`/`seven_day` NÃO ENCONTRADOS |
| C13 | Custo | ESTIMATIVA | `total_cost_usd` não é cobrança |
| C14 | Runner disparado pelo host Tauri (Rust) | NÃO VERIFICADO | Agent SDK é Node: exige sidecar ou CLI direto |

## D. Reaproveitamento do Alethe

| # | Item | Status | Observação |
|---|---|---|---|
| D1 | Licença compatível com cópia de código | **NÃO** | AGPL-3.0 vs MIT do Teracota |
| D2 | Conceitos de estados e prioridade | Reaproveitável como referência | `taskStateMachine.ts`, `taskScheduler.ts` |
| D3 | Recuperação de crash | **Ausente** no Alethe | Lacuna a fechar no Teracota |

## E. Veredito por capacidade (resumo)

- **Pronto para migrar (com evidência):** A1, A2 (parcial), A4, A5 (emulado), A9, B3.
- **Bloqueado por evidência faltante:** A6, A10, A15, B1/B2 comparados, B4, C14.
- **Exige mecanismo próprio do Teracota:** C5, C7, C8, C11, lock e reconciliação.
- **Não é capacidade técnica:** C12 (fonte oficial de limite), conformidade de login (ver auditoria §4).
