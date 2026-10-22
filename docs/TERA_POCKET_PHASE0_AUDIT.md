# Tera Pocket Workspace — Fase 0: auditoria e viabilidade

> Escopo: somente Fase 0 (auditoria + PoCs isolados). Nenhuma implementação de fase posterior, nenhum commit, nenhum push.
> Worktree: `K:\dev\waifu-claude-pocket`, branch `feat/tera-pocket-phase0` (base `05dc270`). Worktrees `feat/mini-companion` e `feat/tera-rig` preservados, com HEAD e alterações não commitadas inalterados.
> Matriz de capacidades: `docs/TERA_POCKET_PHASE0_CAPABILITY_MATRIX.md`.

## 1. Decisão recomendada: GO CONDICIONAL

**Não há decisão de migrar Electron → Tauri ainda.** Recomendo prosseguir apenas para o PoC comparativo da §5. A Fase 1 só começa se ele passar.

- **Nenhum bloqueio nativo encontrado no Tauri** para janela transparente, sempre no topo, sem foco, fora da barra de tarefas e com coordenadas negativas em múltiplos monitores.
- **O ganho que motivaria a migração não está provado.** A memória medida (~323 MB no Tauri) foi uma medição única e não tem comparação com o Electron no mesmo harness.
- **O hover do Electron já é polling + máscara alfa.** A emulação do Tauri tem a mesma arquitetura. A paridade exige portar a máscara alfa, não encontrar uma capacidade que falta no Tauri.

## 2. O que foi verificado (com evidência)

| Área | Resultado | Evidência |
|---|---|---|
| Inventário Electron | 13 áreas mapeadas com arquivo:linha | `docs/phase0/scout-electron-inventory.md` |
| Tauri: janela | Transparente, sem moldura, sempre no topo, sem foco, fora da barra, coordenadas negativas | `docs/phase0/poc-tauri-window-results.md` (T1, T5, T6, T8) |
| Tauri: click-through | `set_ignore_cursor_events` alternado por polling de 33 ms funciona; latência 22–29 ms (máx. 51 ms); nenhum artefato em 1497 capturas sobre fundo branco | T2, T3, T4 |
| Tauri: arrasto | Só com `data-tauri-drag-region` + capability; funciona com ignore=false, não com ignore=true | T7 |
| Tauri: build | Tauri 2.12.2, wry 0.57.0, tao 0.37.1; release em 7m32s; exe ~7,3 MB | `poc/tauri-window/` |
| Runner: início | `session_id` disponível no evento `init`, ~2,5 s antes do primeiro delta | T1 |
| Runner: interrupção | `interrupt()` retorna em 43 ms; resultado `error_during_execution`; a sessão aceita a mensagem seguinte | T2 |
| Runner: crash (SIGKILL do pai) | Transcrito persistido até o `tool_result`; o texto ainda não entregue se perde | T3 |
| Runner: retomada | Funciona com o mesmo `session_id`; **o turno interrompido não é re-executado sozinho** (entra prompt sintético) | T4 |
| Runner: concorrência | **Sem lock de retomada.** Duas retomadas simultâneas geram ramos divergentes no mesmo JSONL | T5 |
| Runner: duplicação | Sem duplicação de escrita nos cenários testados | T6 |
| Claude Code: capacidades | Stream JSON, resume, interrupt e `defer` de permissão (só `-p`) confirmados por documentação | `docs/phase0/scout-runner-capabilities.md` |
| Alethe | Licença AGPL-3.0; núcleo de estados, dependências e prioridade reutilizável **só como conceito**; sem recuperação de crash | `docs/phase0/scout-alethe-reuse.md` |

## 3. O que não foi verificado ou está contra a tese

- **Memória e CPU comparadas ao Electron:** não medidas no mesmo harness. Os números do Tauri são n=1.
- **Cold start:** medido até o canal de controle responder, não até o primeiro frame pintado.
- **DPI misto:** não testado (ambos os monitores a 100%). É exatamente onde o próprio Electron registra limitações (`entity.ts:94-96`).
- **Hit-test por pixel de alfa no Tauri:** não portado. O PoC testou por retângulo.
- **Z-order acima de tela cheia:** o Electron usa o nível `screen-saver`; no Tauri só foi testado sobre janela maximizada.
- **Issue tauri #15947** (janela transparente + alternância de cursor events no Windows): não reproduziu em uma GPU, em ~30 s. Não é prova de resolução.
- **Arrasto:** só com mouse sintético; o delta exato ficou inconclusivo.
- **Crash com efeito parcial:** não testado. "Sem duplicação" vale só para crash depois do `tool_result`.
- **Kill do processo filho e árvore (`/T`):** não testados.
- **Retomar sem prompt, e qual ramo vence após o T5:** inconclusivos.
- **Runner disparado pelo host Tauri** (sidecar Node ou chamada direta ao CLI): não testado. O Agent SDK é Node; o host Tauri é Rust.
- **Servidor HTTP/MCP:** precisa ser reescrito em Rust, com as mesmas regras de Origin/Host. Não iniciado.

## 4. Riscos e pontos de conformidade

- **Assinatura Claude (Pro/Max):** a documentação oficial veda o repasse de credenciais de planos a terceiros e o uso de login claude.ai em produtos de terceiros. Os PoCs usaram o login do próprio usuário no binário oficial, como o PoC anterior. **Questão de produto pendente, não técnica:** antes de qualquer produto distribuído, perguntar à Anthropic ou usar API key.
- **Limites de uso:** `five_hour` e `seven_day` **não foram encontrados** na documentação local. `total_cost_usd` é estimativa, não cobrança. O chip de uso deve mostrar "indisponível" até haver fonte oficial.
- **Alethe (AGPL-3.0):** copiar código obrigaria a AGPL no Teracota (MIT). Reimplementar a partir de conceitos. Consequências jurídicas a verificar com advogado.
- **Risco de sessão externa:** `claude --resume` num terminal não passa pelo lock do Teracota.

## 5. Próxima etapa proposta (ainda Fase 0)

Antes de qualquer decisão de migração, um PoC comparativo com o mesmo harness nos dois hosts, n≥3:

1. Hit-test por pixel: máscara de 64 px portada, divergência Tauri vs Electron ≤1% em ≥500 pontos, em 3 poses incluindo flip.
2. Latência de hover p95 Tauri ≤ Electron + 10 ms e ≤ 60 ms absoluto (≥50 ciclos).
3. DPI misto (100% + 125% ou 150%), com a janela cruzando a fronteira: 0 erros de hit-test em 100 pontos por monitor; posição com erro ≤ ±2 px; arrasto final a ≤ ±4 px do cursor.
4. Memória e CPU: Private Bytes somados da árvore (não WorkingSet), 60 s, 1 e 3 janelas. Critério: Tauri ≤ Electron + 10%; CPU em repouso < 2%.
5. Cold start até o primeiro frame pintado: 5 frios e 5 quentes, Tauri ≤ Electron.
6. Z-order sobre tela cheia sem borda (vídeo/F11): paridade com o Electron.
7. 20 arrastos com mouse físico, incluindo saída rápida e soltar fora: 0 perdidos.
8. 30 min de modo emulado: 0 artefatos e 0 estados "Tera não clicável".
9. Runner disparado pelo host Tauri: `session_id`, interrupt e encerramento da árvore; 0 processos `claude` órfãos após 5 kills do app.
10. Tray: clique esquerdo/direito, menu com checkbox/radio e single-instance.

Custo: o PoC comparativo exige um monitor com escala diferente de 100% (item 3) e um Electron rodando lado a lado com o mesmo harness.

## 6. Design a incorporar na Fase 3 (independente do host)

- **Lock por sessão:** arquivo com criação exclusiva por `session_id`, com PID, hora de início e heartbeat. Abandonado se o PID morreu ou o heartbeat passa de 30 s. O core recusa start/resume com lock ativo.
- **`session_id` escolhido pelo host:** opção `sessionId` do SDK, gravado no banco antes do spawn.
- **Reconciliação sem auto-resume:** tarefa em `running` com processo morto vira `paused/interrupted`. Mostrar `git status`/diff. O usuário decide "Continuar", com prompt explícito.
- **Flag "interrompido pelo usuário":** `error_during_execution` não distingue interrupção de erro real.

## 7. Incidentes e observações do processo

- **Escrita fora do workspace:** em uma tentativa do PoC do runner (com `acceptEdits`), o modelo escreveu `K:\dev\T3-a.txt`, fora do workspace. O arquivo foi removido e confirmado ausente. Os testes seguintes usaram `canUseTool` e caminhos absolutos.
- **Scouts:** três atingiram o limite de turnos e precisaram ser retomados. O Scout de Tauri não tinha WebFetch/WebSearch; a pesquisa foi feita diretamente. Alguns Scouts declararam que não podiam gravar relatórios; os arquivos foram salvos pelo orquestrador.
- **Lacuna da pesquisa Tauri:** as páginas de referência do v2.tauri.app foram truncadas antes da seção WindowConfig; os campos foram confirmados por docs.rs.
- **Correção de rumo:** uma versão inicial do meu raciocínio tratava a diferença "retângulo vs pixel" como limite do Tauri. A revisão do Architect mostrou que é uma simplificação do PoC: o Electron também usa polling + alfa.
- **Custo:** cerca de 7 sessões de haiku no PoC do runner, mais as sessões de Scout. Pequeno, mas da franquia do usuário.

## 8. Pedido de aprovação

Para avançar, preciso que você decida:
1. **Aprovar o GO CONDICIONAL** e autorizar o PoC comparativo da §5 (inclui um Electron de referência e um monitor com escala diferente de 100%), ou **manter o Electron** e adiar a migração.
2. **Confirmar a questão de conformidade** (§4) antes de qualquer distribuição com o login da assinatura.
3. **Decidir o destino do worktree** `feat/tera-pocket-phase0`: mantenho como está, sem commit, até sua aprovação.

Nada foi commitado e nenhuma fase posterior foi implementada.
