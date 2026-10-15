# Teracota 2.0, Ciclo 1: Tera Agent Bridge (checkpoint)

> Data: 2026-10-15 · Branch: `feat/agent-bridge` (local, sem push) · Orquestração: `/route`

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
