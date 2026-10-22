# Tera Pocket Workspace — Relatório da Fase 0.5

> Status: **aguardando aprovação para a Fase 1**. Nenhuma migração definitiva autorizada.
> Worktree: `K:\dev\waifu-claude-pocket`, branch `feat/tera-pocket-phase0` (base `05dc270`). Nenhum commit, push, release ou deploy. Worktrees `feat/mini-companion` e `feat/tera-rig` preservados.
> Evidências: `docs/phase0/parity/` (Frente A), `docs/phase0/safety/` (Frente B), `docs/phase0/runner-contract.md` (contrato), `docs/TERA_POCKET_PHASE0_AUDIT.md` e `docs/TERA_POCKET_PHASE0_CAPABILITY_MATRIX.md` (Fase 0).

## 1. Resumo executivo

- **Migração para Tauri: não recomendada agora.** O Tauri mostrou paridade funcional na janela (transparência, foco, multi-monitor com coordenadas negativas, click-through com a mesma máscara alfa), mas **perdeu em todas as métricas de recurso medidas**: mais memória, mais CPU e início visivelmente mais lento no primeiro frame.
- **Nenhuma vantagem do Tauri foi demonstrada.** Não há base para declarar superioridade em nenhuma métrica.
- **Mecanismos de segurança do runner: validados com runner falso e processos reais.** Lock exclusivo, journal, reconciliação sem reexecução automática e aprovação de uso único funcionam nos testes. **Não foram validados contra o Claude real** nos cenários de erro de autenticação, sessão expirada e limite de uso.
- **Conformidade: a distribuição a terceiros com login de assinatura está vedada pela documentação oficial.** Uso pessoal local com o próprio login segue a documentação, mas a leitura deve ser confirmada antes de qualquer distribuição.

## 2. Frente A — Comparativo Electron × Tauri

### 2.1 Condições do harness

- Mesma página (`poc/parity/shared`): sprite 4 frames, 260 px, janela 320×440, transparente, sem moldura, sempre no topo, sem foco, fora da barra.
- Polling de cursor a cada 33 ms; máscara alfa 64×64 com limiar 40. Electron: `nativeImage` no processo principal. Tauri: canvas no JS, enviada ao Rust.
- Um host por vez, nunca simultâneos.
- Ambiente: Windows 11, 2 monitores (1920×1080 primário; 2560×1440 em x=-2560, y=-355), **ambos a 100%**. Electron 44.4.5; Tauri 2.12.2 (WebView2).
- Limitação central: o sprite de teste não é o app real. Os números valem para este PoC, não para o Teracota completo.

### 2.2 Matriz comparativa

| Métrica | Electron | Tauri | Status | Diferença acima do ruído? |
|---|---|---|---|---|
| **M1 memória, 1 janela** (Private Bytes da árvore, 60 s) | 124,9 MiB (sd 1,7) | 134,2 MiB (sd 0,3) | MEDIDO | Sim: Tauri +9,3 MiB |
| **M1 memória, 3 janelas** | 190,7 MiB (sd 2,4) | 213,2 MiB (sd 1,7) | MEDIDO | Sim: Tauri +22,5 MiB |
| **M2 CPU idle, 1 janela** (% de 1 núcleo) | 2,32 (sd 0,69) | 5,50 (sd 0,30) | MEDIDO | Sim: Tauri 2,4× |
| **M2 CPU idle, 3 janelas** | 5,36 (sd 0,64) | 13,92 (sd 0,51) | MEDIDO | Sim: Tauri 2,6× |
| **M2 CPU com cursor em movimento** (sem botão) | 3,47 (sd 0,47) | 6,62 (sd 0,58) | MEDIDO | Sim: Tauri 1,9× |
| **M3 primeiro frame, quente** (ms) | 380 (p50 371, sd 25) | 666 (p50 665, sd 6) | MEDIDO | Sim: Tauri +286 ms |
| **M3 primeiro frame, frio de perfil** (ms) | 418 (p50 374, sd 91) | 3046 (p50 2959, sd 231) | MEDIDO | Sim: Tauri +2,6 s |
| **M4 click-through** (704 pontos) | 2 divergências (0,28%) | 1 divergência (0,14%) | MEDIDO | **Não** (diferença de 1 ponto, nas bordas da máscara) |
| **M6 roubo de foco** (5 execuções) | 0/5 | 0/5 | MEDIDO | Não |
| **M9 multi-monitor** (posições negativas, janela a cavalo) | 5/5 exatas | 5/5 exatas | MEDIDO | Não |
| **M8 bandeja** | existe (API) | existe (API) | MEDIDO só por API | — |
| M5 latência de hover | — | — | **NÃO TESTADO** (código pronto, fora desta rodada) | — |
| M7 arrasto físico | — | — | **NÃO TESTADO** (código pronto) | — |
| M10 DPI misto | — | — | **NÃO TESTADO** (exige alterar a escala do sistema; proibido) | — |
| M11 z-order sobre tela cheia | — | — | **NÃO TESTADO** (código pronto) | — |
| Clique real no ícone da bandeja | — | — | **NÃO TESTADO** (automação não confiável) | — |

### 2.3 Leitura dos resultados

- **Em todas as métricas de recurso medidas, o Electron foi melhor neste PoC.** Esse resultado é repetível: os desvios entre execuções são pequenos comparados às diferenças.
- **Hipótese não investigada para a CPU:** o polling de cursor no Tauri passa por `webview_windows()` e `cursor_position()` em thread Rust a cada 33 ms, somado à pilha WebView2. Não há profiling; isto é hipótese.
- **Hipótese para o frio:** a penalidade do Tauri está na criação do perfil WebView2. Em produção o perfil persiste, então o caso "quente" tende a ser o relevante. Isto também é hipótese.
- **Limitação do frio:** o cache de disco do SO não foi limpo (reboot proibido). O resultado é "frio de perfil", não frio completo.
- **Não extrapolar:** o PoC tem um sprite de 4 frames e nenhuma lógica do app real. O custo de memória e CPU do app completo pode ser diferente em qualquer direção.
- **Ponto de atenção:** o pico de 1 smoke test no Electron (~11 s na primeira execução do sistema) não foi reproduzido nem investigado.

### 2.4 Critério de paridade funcional

Os itens de paridade de comportamento (M4, M6, M8, M9) **não mostraram diferença**. O que impede a migração não é uma falha funcional: são recursos e latência, mais os itens ainda não testados (M5, M7, M10, M11).

## 3. Frente B — Segurança do runner

Testado com runner falso e processos reais, em `poc/runner-safety/`. **29 testes passam** (`node --test --test-concurrency=1`).

| Cenário | Resultado | Status |
|---|---|---|
| A. Lock exclusivo: 6 processos concorrentes | 1 vencedor em cada execução | VERIFICADO (runner falso) |
| A. Lock de processo morto (kill -9) | Assumido pelo próximo | VERIFICADO |
| A. PID reutilizado | Detectado, **apenas simulado** | SIMULADO |
| A. Lock ativo com heartbeat recente | Nunca removido | VERIFICADO |
| B. Journal com última linha truncada (cada byte) | Estado anterior mantido | VERIFICADO |
| C. Transições fora da tabela | Recusadas (teste exaustivo) | VERIFICADO |
| D. Orquestrador morto (kill -9) | Tarefa vai a `needs_reconcile` sem reexecução | VERIFICADO |
| E. Aprovação de uso único | Ação sem aprovação, ou com aprovação de outra ação, recusada | VERIFICADO |
| F. Efeito verificável | Não duplicado; não verificável → `needs_reconcile` | VERIFICADO |
| G. Auth, sessão expirada, limite de uso | Estados próprios, sem retry; transitório: backoff, máx. 3 retries | VERIFICADO (strings inventadas) |
| H. Duas instâncias do orquestrador na mesma sessão | Uma recusada | VERIFICADO |
| H. Retomada explícita com novo lock | Funciona | VERIFICADO |
| **Claude real** (erros de auth, expiração e limite) | Formatos não observados | **NÃO TESTADO** |

**Defeito real encontrado e corrigido:** sob carga, a consulta ao tempo de criação do processo falhou e foi lida como "PID reutilizado". Quatro processos ganharam o mesmo lock na primeira rodada. Agora só uma divergência positiva conta como reuso. Há teste de regressão.

**Lacunas conhecidas:**
- Windows sem fsync de diretório (criação e rename podem não ser duráveis após queda de energia);
- consulta de tempo do processo via PowerShell, lenta e sensível à carga;
- heartbeat vencido com processo vivo abre janela de dois donos (mitigação: fencing por nonce antes de cada `allow`);
- `claude --resume` externo escapa ao lock;
- git e push modelados como efeito não verificável, nunca contra um git real.

## 4. Proposta de contrato do runner e máquina de estados

Documento completo: `docs/phase0/runner-contract.md`. Resumo:

- **Duas máquinas ligadas:** a da **tarefa** (persistida no journal; é o que a UI mostra) e a da **sessão** (derivada de lock e transcrito). Invariante central: tarefa em `running`/`awaiting_approval` só existe com sessão ativa; qualquer quebra leva a `needs_reconcile`.
- **O adapter não guarda estado.** Core é o único escritor do journal.
- **Resume sempre com prompt explícito e gesto do usuário.** Nunca `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`, porque reexecuta o turno interrompido.
- **Sucesso do turno leva a `review`**, não a `completed` (muda a spec §5.9 e o PoC).
- **Aprovação:** só por gesto da UI, registrada com assinatura por chave em memória (perdida ao reiniciar), uso único, TTL de 10 min.
- **Retry:** só para erro transitório e só se não houve nenhum tool_use autorizado.
- **Auth, sessão expirada e limite de uso** são estados próprios, sem retry automático e sem contorno.

**Decisões que dependem de você (12, detalhadas no contrato §9):** divergências da spec §3.2; `success` levando a `review`; política padrão de escrita e Bash; TTL; `forceAfterMs` do interrupt (10 s); número de retries; persistência (SQLite ou JSONL); lock do SO mais Job Object no Rust ou port do PoC; `canUseTool` ou `defer` para aprovação; mapeamento de erros reais com sessões da sua franquia; autoexecução (padrão manual); modo de distribuição.

## 5. Frente C — Conformidade

### 5.1 Interfaces oficiais e condições (fonte: documentação oficial local, consultada em 2026-10-09)

| Interface | Uso | Condição |
|---|---|---|
| Claude Code CLI (`claude`) | Uso interativo e scripts | Binário oficial, sem modificação |
| Agent SDK (TypeScript/Python) | Integração de aplicação | **Autenticação com API key** para desenvolvedores de produto (`legal-and-compliance.md:50`) |
| Login da assinatura (Pro/Max) | Uso nativo do próprio usuário | Uso pessoal; não repassar a terceiros (`legal-and-compliance.md:49-52`) |
| Channels, Remote Control | Mensagens e controle remoto | Research preview ou canais oficiais; sem credencial própria |

### 5.2 Uso local pessoal × distribuição a terceiros

| Cenário | Leitura da documentação | Situação |
|---|---|---|
| Teracota rodando **na máquina do próprio usuário**, invocando o `claude` oficial com o login dele | O usuário usa o binário oficial com a própria assinatura, o que a documentação permite (`legal-and-compliance.md:52`) | Permitido em leitura, mas o Teracota **não pode** guardar, ler ou repassar credenciais |
| **Distribuir** o Teracota a terceiros que usam a própria assinatura | A documentação veda "oferecer login Claude.ai em aplicações de terceiros" e "rotear requisições pelas credenciais de planos" (`:50`) | **Vedado** sem decisão da Anthropic |
| Distribuir com **API key** gerida pelo próprio usuário | Caminho documentado para desenvolvedores de produto | Permitido, com custo por uso |

**Recomendação:** antes de qualquer distribuição, consultar a Anthropic pelo canal de vendas indicado na documentação, ou distribuir apenas em modo API key.

### 5.3 Restrições técnicas adotadas

- Nenhuma captura de credenciais, nenhum campo de login ou token no Teracota, nenhum acesso a `~/.claude/.credentials*`.
- Nenhum mecanismo para contornar limites de uso. O chip de uso mostra "indisponível" sem fonte oficial, nunca 0%.
- `five_hour` e `seven_day` **não foram encontrados** na documentação; `total_cost_usd` é estimativa, não cobrança.

### 5.4 Risco de licença do Alethe (AGPL-3.0)

- O Alethe é AGPL-3.0; o Teracota é MIT.
- Copiar código, ou criar derivado, obrigaria a AGPL no Teracota, inclusive a cláusula de uso em rede.
- **Não copiamos nenhum código.** Só conceitos de estados, prioridade e dependências.
- A análise jurídica é de responsabilidade de um advogado; não é parecer técnico.

## 6. Critérios objetivos para aprovar ou rejeitar a migração para Tauri

### 6.1 Rejeitar a migração se qualquer um ocorrer

1. Memória do Tauri **acima do Electron em mais de 10%** no mesmo harness, com 1 e 3 janelas. **Hoje: rejeita** (+7,5% com 1 janela; +11,8% com 3).
2. CPU em repouso do Tauri **acima de 2%** de um núcleo, ou acima do Electron. **Hoje: rejeita** (5,50% e 13,92%).
3. Primeiro frame quente do Tauri **acima do Electron em mais de 60 ms**. **Hoje: rejeita** (+286 ms).
4. Qualquer falha de paridade funcional em M4, M6, M7, M9 ou M11.
5. Divergência de hit-test por pixel acima de 1% em ≥500 pontos com a máscara completa portada.

### 6.2 Aprovar a migração **somente se todos** ocorrerem

1. Memória e CPU do Tauri dentro de 10% do Electron em 1 e 3 janelas, medidos no **app real** (não no sprite).
2. Primeiro frame quente do Tauri ≤ Electron + 60 ms.
3. M5 (hover p95) do Tauri ≤ Electron + 10 ms e ≤ 60 ms absolutos, com ≥50 ciclos.
4. M7 (arrasto físico): 20 arrastos, 0 perdidos.
5. M10 (DPI misto) com 100% + 125% ou 150%, sem erro de hit-test em 100 pontos por monitor. **Exige o usuário ajustar a escala do monitor**, o que o harness não faz sozinho.
6. M11 (z-order sobre tela cheia): paridade com o Electron.
7. Runner disparado pelo host Tauri (sidecar Node ou CLI direto): `session_id`, interrupt e encerramento da árvore; 0 processos `claude` órfãos após 5 kills do host.
8. Erros reais do Claude mapeados (auth, sessão expirada, limite) com evidência, ou marcados como indisponíveis.
9. Conformidade resolvida para o modo de distribuição escolhido.

### 6.3 Situação hoje

- **Rejeição por desempenho: já configurada** (critérios 1 a 3 de 6.1 são falsos).
- **Aprovação: não atingida.** Faltam M5, M7, M10, M11, o runner no host Tauri e o app real.
- **Conclusão objetiva:** o Electron permanece. Não há evidência para migrar; há evidência contrária em recurso e latência.

## 7. Verificado × não verificado (resumo)

**Verificado (com evidência):** paridade de janela (transparência, foco, multi-monitor, coordenadas negativas) nos dois hosts; memória, CPU e primeiro frame medidos com n≥3 ou 5+5; lock, journal, transições, reconciliação e aprovação com runner falso e kills reais; sessão reutilizável após interrupt; retomada sem reexecução automática (Claude real, n=1); CLI sem lock de retomada (Claude real, n=1).

**Não verificado:** M5, M7, M10, M11; clique real na bandeja; formatos reais de erro de auth, expiração e limite; ledger de efeitos com o Claude real; crash entre efeito e `tool_result`; kill da árvore e Job Object; runner no host Tauri; reuso real de PID; comportamento em Linux e macOS.

## 8. Incidentes e limitações do processo

- **Escrita fora do workspace (Fase 0):** um teste do runner gravou um arquivo em `K:\dev\T3-a.txt`; removido e confirmado. Os testes seguintes confinaram escrita com `canUseTool`.
- **Sessões de teste:** o runner consumiu cerca de 7 sessões de haiku na Fase 0 e algumas na Fase 0.5 com o Claude real. Pequeno, mas da franquia do usuário.
- **Sub-agentes:** vários atingiram o limite de turnos e foram retomados; alguns recusaram gravar arquivos alegando regras que eu não configurei, e eu salvei os arquivos.
- **Build do Tauri:** o `target` ocupa cerca de 1 GB em `poc/parity/tauri/target` e em `poc/tauri-window/target`, ignorado pelo git.
- **Escala do sistema intocada:** não foi possível testar DPI misto sem alterar a configuração de exibição, o que não foi feito.

## 9. Pedido de decisão

1. **Manter o Electron** como host atual e não migrar agora (recomendado pelos critérios da §6.3). Ou autorizar a **Fase 1 em modo de avaliação** (sem substituir o Electron), com os itens faltantes da §6.2.
2. **Aprovar ou ajustar** as 12 decisões do runner (`docs/phase0/runner-contract.md` §9).
3. **Conformidade:** confirmar o modo de distribuição (uso pessoal ou terceiros; API key ou consulta à Anthropic) antes de qualquer implementação de integração.
4. **Se for autorizada uma medição extra de DPI misto:** você precisa ajustar a escala de um monitor (125% ou 150%) para o teste. Não farei isso sem sua instrução explícita.
5. **Destino do worktree** `feat/tera-pocket-phase0`: mantido sem commit até sua decisão.

Nenhum commit, push, release ou deploy foi feito. Nenhum código do companion de produção foi alterado.
