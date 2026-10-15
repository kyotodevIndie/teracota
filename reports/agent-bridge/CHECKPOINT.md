# Teracota 2.0: Tera Agent Bridge (checkpoint)

> Branch: `feat/agent-bridge` (local, sem push) · Orquestração: `/route`
> Ciclo 2 abaixo. O ciclo 1 vem depois, preservado como registro.

# Ciclo 2: homologação visual, revisão de segurança e integração do mascote (2026-10-15)

## C2.1 Estado inicial

- HEAD `ebf5365` com árvore limpa. Só havia arquivos não rastreados de outros trabalhos (`LAUNCH_READINESS_REPORT.md`, `PROJECT_STATUS_REPORT.md`, `TERA_PHASE1_TASK.md`, `docs/TERA_RIG_AUDIT.md`, `poc/`).
- 227 testes passando.
- `ANTHROPIC_API_KEY` **ausente**: só a presença foi checada, sem ler o valor. O smoke real **nunca foi executado**.

## C2.2 Arquitetura implementada

```
AgentProvider (claude-code real | "simulado" só em dev)
   └─► BridgeManager ──(BridgeEvent)──► painel (IPC panel:event)
                     └─► companion-link ──(AgentSignal)──► EntityManager.handleSignal ──► Tera
                                                              ▲
                                    hooks de sessões externas ┘ (inalterados)
```

- **`src/main/bridge/companion-link.ts`:** genérico, não conhece o provider. A fonte do sinal é `{provider: id do provider, sessionId: handle UUID, project: cwdLabel}`. O handle nunca colide com o `session_id` dos hooks, e os sinais **não carregam texto da conversa**. Mapeamento:

  | Evento da sessão | Sinal para a Tera |
  |---|---|
  | Sessão iniciada | `lifecycle: start` + attention, "Sessão iniciada no painel." |
  | Agente trabalhando | thinking ou a atividade da ferramenta; a tabela `toolState` é a mesma dos hooks |
  | Aguardando permissão | attention, "Preciso da sua permissão no painel." |
  | Resposta recebida | typing, uma vez por turno |
  | Turno concluído | happy, "Pronto!" |
  | Erro | error, "Hmm, deu erro." (sem a mensagem) |
  | Interrompido | idle, "Interrompido." |
  | Sessão encerrada | `lifecycle: end` + sleeping, "Até mais! 💤" |

- **`src/main/bridge/simulated.ts`:** provider `simulado`, ativo só com `TERACOTA_AGENT_PANEL=1` + `TERACOTA_AGENT_PANEL_SIM=1` + `!app.isPackaged`.
  - Todo texto sai rotulado `[simulado]`/`[SIMULAÇÃO]`, e o painel mostra o banner fixo "SIMULAÇÃO — nenhum agente real".
  - Comandos: `/permissao`, `/erro`, `/lento`, `/desconectar`.
  - Não executa nada, não ecoa nem loga o texto do usuário, e não é pré-selecionado se houver outro provider disponível.
- **`src/main/panel/pick-folder.ts` (`resolvePickFolder`):** a pasta temporária vale só para o simulado com a simulação ligada. O provider real **sempre** passa pelo diálogo nativo. As pastas temporárias são removidas no `before-quit`.
- Nada de hooks, CLAUDE.md ou settings: `settingSources: []` continua intacto.

## C2.3 Achados e correções

| # | Origem | Achado | Correção |
|---|---|---|---|
| P0-1 | reviewer | `interrupt()` aguardava `q.interrupt()` fora da corrida com o timeout; um interrupt travado bloqueava a sessão | `q.interrupt()` entra na corrida com o fim do turno, o timeout e a falha; timeout ou falha deixam a sessão `dead` e chamam `close()`. Testes (a), (b) e (c) |
| P0 | reviewer | Os 5 ajustes do ciclo 1, `settingSources: []`, isolamento de permissões, encerramento e IPC | Aprovados |
| P0 | reviewer | zod 3 → 4 | **Sem regressão**: só `mcp.ts` e `panel/ipc.ts` usam zod, com APIs compatíveis |
| P0 | reviewer | MCP | Teste ad hoc com o servidor real (`mcp.ts` via esbuild + `StreamableHTTPClientTransport`): `inputSchema` correto, chamadas válidas ok, inválidas → `-32602` |
| V1/V3/V6 | homologação real | "Encerrar sessão" visível sem sessão; dois "Recolher"; estado e erro antigos depois de Encerrar | Causa raiz: o `display` do CSS anulava `[hidden]`. Agora `[hidden]{display:none!important}` e o painel limpa o estado ao encerrar |
| V8 | homologação real | Estado inicial vazio, sem orientação | Mensagem "Escolha um agente e uma pasta para começar." |
| V5 | homologação real | O cartão de permissão não rolava o histórico | O histórico rola até o fim |
| R-1/R-2 | reviewer | Pastas temporárias nunca removidas; regra do pickFolder sem teste | Remoção restrita ao prefixo em `os.tmpdir()`; `resolvePickFolder` com 3 testes |

## C2.4 Evidências de testes (saída real)

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | ok |
| `npm run lint` | 86 arquivos, sem achados |
| `npx vitest run` | **22 arquivos, 260 testes passando** (eram 227) |
| `node build.mjs` | ok |
| Logs do app real | só `[bridge] <handle> <estado>`; um grep pelos prompts usados nos testes (`olá`, `/lento`, `/permissao`, `/erro`, `parte 1`) não achou nada |

## C2.5 Homologação visual (Electron real, sem chamadas pagas)

Lançamento: `TERACOTA_AGENT_PANEL=1 TERACOTA_AGENT_PANEL_SIM=1 TERACOTA_PORT=47999 npx electron . --remote-debugging-port=9333 --inspect=9334`. Dirigido por CDP: cliques via DOM, screenshots das janelas e `setSize`/`show()` pelo inspector do main. Screenshots em `reports/agent-bridge/shots/`. A tabela completa (real × automatizado × não homologado) está em `docs/dev/agent-bridge.md`.

- **Visto no app real:**
  - abertura;
  - layout em 320×420 (mínimo), 400×600 e 720×900, sem overflow;
  - pasta (simulado);
  - estados vazios;
  - Claude indisponível, com o motivo da chave;
  - sessão simulada;
  - streaming;
  - Permitir/Recusar;
  - Interromper;
  - Recolher/reabrir, com o mesmo histórico e a mesma sessão, e o reload reidratando;
  - fechar no X só esconde a janela;
  - Encerrar;
  - `/erro` e `/desconectar`, incluindo o envio depois de desconectar;
  - Tera clássica reagindo (trabalhando/digitando, permissão, "Pronto!", "Hmm, deu erro.", "Até mais! 💤");
  - remoção das pastas temporárias ao sair.
- **Não homologado:**
  - fluxo com o Claude real (sem autenticação oficial nem smoke);
  - clique no item nativo "Conversar (experimental)" do menu/tray (a reabertura foi feita pelo mesmo `show()` via inspector);
  - diálogo nativo de pasta;
  - Mini Companion, que **não reage** às sessões do painel.
- O perfil dev estava em modo `ui: mini`. A janela clássica da Tera ficou oculta, mas renderizando, e foi inspecionada assim.

## C2.6 Limitações restantes

1. **O fluxo com o Claude não está homologado.** Falta a `ANTHROPIC_API_KEY` própria do usuário, e o smoke não foi executado. O custo do ciclo foi **US$ 0**.
2. O Mini Companion (experimental) não consome os sinais do painel.
3. Na pose de erro a Tera fica neutra e só o balão indica o erro (a skin não tem expressão de erro distinta).
4. Os commits por domínio não foram compilados um a um; só o estado final passou pelos gates.
5. Quality Gate: a revisão arquitetural crítica pós-implementação **não foi feita** neste ciclo, por causa do limite de 6 delegações (a delegação reservada foi para a revalidação do reviewer, como pedido). O architect desenhou o plano, e o reviewer aprovou a entrega e a correção.

## C2.7 Commits do ciclo 2

Ver `git log --oneline ebf5365..HEAD`: `feat(bridge)` → `feat(integrations)` → `feat(mascote)` → `feat(panel)` → `docs`.

## C2.8 Prompt do ciclo 3

```
TERACOTA 2.0, CICLO 3. Branch feat/agent-bridge. Leia reports/agent-bridge/CHECKPOINT.md (ciclo 2) e docs/dev/agent-bridge.md.
P0: revisão arquitetural crítica do ciclo 2 (companion-link, simulado, pick-folder, interrupt). Ela ficou pendente por limite de delegações.
P1: se o usuário fornecer ANTHROPIC_API_KEY no ambiente E autorizar explicitamente, rodar UMA vez o smoke (docs/dev/agent-bridge.md › Smoke futuro), informando o custo antes (teto US$ 0,05), e então homologar o painel com o Claude real. Sem chave: registrar o bloqueio e seguir.
P2: Mini Companion consumir os mesmos AgentSignals (ou decidir descontinuá-lo); clique real no menu nativo e no diálogo de pasta (computer use ou teste manual guiado).
P3: settingSources opt-in por projeto, com consentimento explícito na UI (sem reativar hooks por padrão).
P4: só depois do P1, começar a planejar upload, screenshot e voz.
Mesmas regras: /route (máx. 6 delegações), IPC validado, sem login da assinatura, sem push/PR/merge, commits locais por domínio, checkpoint atualizado.
```

---

# Ciclo 1 (registro)

## 1. Estado inicial

- Branch `feat/mini-companion` igual a `main` (`05dc270`), com o Mini Companion **não commitado**: 5 arquivos rastreados alterados mais `src/main/companion/`, `ui-mode.ts`, preload, renderer e contrato.
- typecheck, lint e 167 testes passavam.
- As branches `feat/tera-pocket-phase0`, `feat/tera-pocket-phase1` e `feat/tera-rig` apontavam para `main` e não tinham trabalho próprio.
- Focus Mode e Hybrid Mode **não existem** no código; aparecem só no ROADMAP e nos relatórios.
- Fluxo com o Claude Code era **só de entrada**: hooks (via `curl`) → `/hook`, e o MCP (`say`/`emote`) também só falava do Claude para a Tera.
- `poc/claude-gui/` (isolada, não rastreada) já tinha provado o Agent SDK contra o Claude Code 2.1.224.

## 2. Arquitetura encontrada

- **Electron:** janela da Tera (`entity.ts`, `contextIsolation`, sem `sandbox`), preload `teracota`, canais em `shared/ipc.ts`. Os handlers validavam o remetente, mas não os tipos.
- **Companion Core:** contrato `integrations/types.ts` (AgentSignal/AgentConnector) e adapter `integrations/claude-code/`. `integrations.test.ts` impede código específico de agente fora de `integrations/`.
- **Sessões:** `SessionTracker`, com chave `provider:sessionId`.
- **Servidor:** HTTP 127.0.0.1 com `/hook`, `/api/v1/event` e `/mcp`.
- **Skins:** `skins.ts` e o renderer (`sprite-character`, `svg-character`, `states`).

## 3. Decisões técnicas

| Decisão | Motivo |
|---|---|
| **Tera Agent Bridge** separado: contrato `shared/bridge.ts`, core `main/bridge/` (`AgentProvider`, `BridgeManager`) e provider em `integrations/claude-code/bridge-provider.ts` | Separar o Companion do Bridge, abstrair por provedor e respeitar `integrations.test.ts` |
| Mecanismo: **Claude Agent SDK** `@anthropic-ai/claude-agent-sdk@0.3.289` (exato, devDependency, import lazy) com o `claude` do PATH | É a interface documentada e bidirecional. Hooks e MCP são só entrada; Channels é research preview |
| **Autenticação só por `ANTHROPIC_API_KEY` do ambiente.** Se o `init` vier com `apiKeySource` diferente de `ANTHROPIC_API_KEY`, a sessão é abortada | A doc oficial do SDK diz: "Anthropic does not allow third party developers to offer claude.ai login [...] Use the API key authentication methods". Não há fallback silencioso para o login da assinatura. A app nunca grava, loga nem envia a chave ao renderer |
| `settingSources: []` | No SDK não há diálogo de confiança da pasta. Com settings carregados, hooks e regras `allow` do projeto rodariam sem consentimento |
| `permissionMode: 'default'`, sem `bypassPermissions` e sem "sempre permitir" | Toda ferramenta sensível passa pelo cartão do painel (Permitir/Recusar, com detalhe completo e aviso de "fora do projeto") |
| Painel em **janela nova** (`main/panel/`), com `sandbox`, CSP sem `unsafe-inline` em script e texto só via `textContent` | Não mistura com o Mini Companion experimental e preserva o mascote |
| Pasta escolhida só pelo diálogo nativo no main. O renderer nunca envia caminhos e o `resumeId` é validado contra a lista do main | Evita acesso irrestrito ao sistema de arquivos |
| IPC com zod `.strict()` e checagem de remetente. Erros são genéricos e não ecoam o payload | Validação explícita do IPC |
| Logs só com handle e estado, nunca o texto | Não registrar prompts |
| **Flag:** `TERACOTA_AGENT_PANEL=1` e `!app.isPackaged` | O painel fica desligado por padrão e não existe no app empacotado |
| zod 3 → **4.6.7** | É peer dependency do SDK. `mcp.ts` só usa a API básica; o reviewer testou com MCP SDK 1.30 em teste ad hoc |

## 4. Funcionalidades implementadas

- Contrato com estados `starting/idle/running/waiting-permission/done/error/cancelled/closed` e eventos (text-delta, message, tool, permission-request/resolved, turn-end).
- `BridgeManager`: histórico em memória (até 200 itens), `send` só fora de turno, `interrupt` (nega permissões pendentes e termina em `cancelled`) e `closeAll` no `before-quit`.
- Provider Claude Code: streaming, `canUseTool`, `interrupt`, `listSessions`/`resume` e gate de autenticação. Tratamento de iterador morto, de timeout do interrupt (a sessão é encerrada) e de falha no `start`.
- Painel: escolher provider (mostra o motivo se estiver indisponível) → escolher pasta → sessão nova ou retomada → prompt → resposta em streaming → indicador de estado e faixa de erro → cartão de permissão → Interromper / Recolher / Encerrar. Fechar ou recolher só esconde a janela; a sessão continua. Com permissão pendente, a janela reaparece sem roubar o foco.
- Menu "Conversar (experimental)" no menu da Tera e no do tray, só com a flag ligada.
- `scripts/agent-smoke.ts`, um smoke manual com estas travas: exige a chave, aborta se `apiKeySource` não for a chave, roda em pasta temporária vazia, usa Haiku e `maxTurns: 1`, `maxBudgetUsd: 0.05` e timeout de 60 s, nega todas as permissões, não repete e não manda arquivos.

## 5. Testes executados (saída real, 2026-10-15)

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | ok |
| `npm run lint` | 80 arquivos, sem achados |
| `npx vitest run` | **19 arquivos, 227 testes passando** (eram 167). Novos: manager, bridge-provider (opções, eventos, allow/deny/abort, interrupt, erro, iterador morto, sem chave, `apiKeySource` errado), IPC (rejeições) e janela (fechar = esconder) |
| `node build.mjs` | ok; gera `panel-preload.js` e `renderer/panel.{html,css,js}`; `dist/main.js` mantém o `import()` dinâmico do SDK |
| `npm ls @anthropic-ai/claude-agent-sdk --omit=dev` | vazio (o SDK não vai para o instalador) |
| Quality Gate | reviewer **approved**; architect **changes_requested** (5 ajustes) → aplicados e verificados pelo orquestrador (typecheck, lint, testes, build). O reviewer não revalidou por limite de delegações |

**Não executado:** a interface no Electron (nenhuma homologação visual) e qualquer chamada real ao modelo.

## 6. Bloqueios

1. **Smoke real NÃO executado (custo US$ 0).** Não há `ANTHROPIC_API_KEY` no ambiente, nem na sessão nem no escopo do usuário (só foi checada a presença, sem ler o valor). Usar o login da assinatura com o Agent SDK em app de terceiros não é método documentado, então, pela condição do usuário, o smoke não roda. **A PoC ponta a ponta não está validada:** a infraestrutura foi verificada por testes, a integração real não.
2. Não dá para assumir uma sessão aberta no terminal; só retomar uma sessão salva e fechada. Channels seria o caminho, mas é research preview.
3. O `session_id` só chega depois do primeiro prompt.
4. Com `settingSources: []`, o painel não carrega o CLAUDE.md nem os plugins do usuário, e o mascote não reage às sessões do painel (o hook do plugin não carrega).

## 7. Commits (locais, `feat/agent-bridge`)

Ver `git log --oneline main..feat/agent-bridge`. Ordem: `wip(mini-companion)` → `chore(deps)` → `feat(bridge)` → `feat(integrations)` → `feat(panel)` → `docs`.

## 8. Próximos passos

1. O usuário define `ANTHROPIC_API_KEY` no próprio ambiente (fora da app) e autoriza o smoke: `node build.mjs && node dist/scripts/agent-smoke.js`. Estimativa: menos de US$ 0,01 (Haiku, 1 turno, prompt "Responda apenas: ok"), com teto rígido de US$ 0,05.
2. Homologação visual: `TERACOTA_AGENT_PANEL=1 npm start` → "Conversar (experimental)" → roteiro: pasta, prompt, resposta, permissão recusar/aprovar, interromper, recolher, reabrir.
3. Smoke manual de uma chamada MCP real (`say`) com o zod 4 antes da próxima release.
4. Ligar os eventos do Bridge ao `SessionTracker` (o mascote reage), com dedupe por origem.
5. Decidir `settingSources` opt-in por projeto (consentimento explícito para carregar o CLAUDE.md e as regras).

## 9. Prompt para o ciclo 2

```
TERACOTA 2.0, CICLO 2. Branch feat/agent-bridge (leia reports/agent-bridge/CHECKPOINT.md).
Pré-condição: ANTHROPIC_API_KEY definida pelo usuário no ambiente. Sem ela, pare e registre o bloqueio.
1. Rodar UMA vez o smoke real (dist/scripts/agent-smoke.js), informando o custo antes (teto US$ 0,05), e registrar o resultado.
2. Homologar o painel na app (TERACOTA_AGENT_PANEL=1 npm start) com o roteiro do checkpoint, com screenshots.
3. Integrar os eventos do Bridge ao SessionTracker/mascote (provider:sessionId, sem duplicar com o hook) e mostrar o estado do painel na Tera.
4. settingSources opt-in por projeto, com consentimento explícito na UI.
5. Smoke do MCP com o zod 4.
Mesmas regras: /route, IPC validado, sem push/PR/merge, commits locais por domínio, checkpoint atualizado.
Upload, voz e screenshot só depois de o item 1 passar.
```
