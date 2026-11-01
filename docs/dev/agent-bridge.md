# Agent Bridge e a interface da Tera

Clicar na Tera abre a **interface** dela (uma janela só, separada da personagem; fechar só
esconde). Ela tem três partes:

- **Agentes no terminal**: estado da conexão com cada agente (hooks), botão Conectar,
  copiar o comando pras sessões já abertas e as falas por MCP (`src/main/panel/app-ipc.ts`,
  contrato em `apps/desktop/src/shared/app-panel.ts`).
- **Aba Terminal** (a padrão, **sem custo**): um terminal de verdade (`node-pty` +
  xterm.js, `src/main/panel/terminal.ts` e `src/renderer/panel-terminal.ts`) com o shell do
  usuário; "Abrir o Claude" roda o `claude` oficial com o login que o usuário já tem. Não
  usa o Agent SDK nem API: o app só hospeda o terminal. Os hooks do plugin disparam como em
  qualquer terminal, então a Tera reage a esta sessão também. Um terminal por vez; fechar a
  janela não mata o terminal, sair do app sim. Ctrl+Shift+C / Ctrl+Shift+V copiam e colam.
- **Aba Conversa (API)**: sessões do Agent Bridge (`@tera/agent-bridge`). A Tera reage à
  sessão pelo mesmo caminho dos agentes externos (Companion Core), sem hooks, `CLAUDE.md`
  nem settings do projeto.

Caminho dos dados: `AgentProvider` -> `BridgeManager` (estado e histórico em memória,
`packages/agent-bridge`) -> IPC validado -> janela da interface. Em paralelo,
`linkBridgeToCompanion` converte os eventos em `AgentSignal` -> `EntityManager.handleSignal`
-> estado visual da Tera.

**Situação:** a interface e a conexão estão homologadas no Electron real (dev e empacotado,
Linux). A conversa com o Claude real **nunca foi executada**: exige `ANTHROPIC_API_KEY` (a
política de autenticação não mudou) e o smoke pago depende de autorização.

## Flags

| Variável | Efeito |
| --- | --- |
| `TERACOTA_AGENT_PANEL_SIM=1` | Só com o app **não empacotado**: adiciona o provider "Simulação (sem agente)" e abre a interface ao iniciar. |

`TERACOTA_AGENT_PANEL` não existe mais: a interface está sempre disponível. Exemplo:

```bash
TERACOTA_AGENT_PANEL_SIM=1 pnpm start
```

Pra dirigir o app via CDP, rode o Electron com `--remote-debugging-port=9333` (renderers) e
`--inspect=9334` (main), só em máquina local. O app tem trava de instância única: feche outra
Teracota Dev antes. No Linux com Wayland o app se reabre sozinho em XWayland
(`--ozone-platform=x11`); os argumentos são repassados.

## Modo simulado

Provider local (`src/main/bridge/simulated.ts`), sem rede, SDK, chave nem custo. A pasta é um
diretório temporário `teracota-sim-*` criado pelo main, sem diálogo. Um banner fixo
"SIMULAÇÃO — nenhum agente real" aparece no painel. Nunca é pré-selecionado se houver outro
agente disponível. O texto digitado só escolhe o roteiro (comando exato) e nunca é ecoado.

| Entrada | Roteiro |
| --- | --- |
| qualquer texto | ferramenta fictícia (leitura), ~8 pedaços de texto em streaming, mensagem, turno concluído |
| `/permissao` | pede permissão fictícia; Permitir -> "[simulado] permitido..." / Recusar -> "[simulado] recusado"; conclui |
| `/erro` | turno termina em erro "[simulado] erro sob comando" |
| `/lento` | ~60 pedaços a cada 250 ms, para testar Interromper e streaming longo |
| `/desconectar` | erro "[simulado] agente desconectado"; os envios seguintes também dão erro |

O que o modo simulado **NÃO prova**: autenticação, integração real com o Agent SDK, formato
real dos eventos do Claude, permissões reais de ferramentas, custo, latência ou qualquer
comportamento do modelo. Prova só a interface do painel, o BridgeManager e a reação da Tera.

## Homologação visual

Distinguir o que foi visto no Electron real do que só os testes automatizados cobrem.
"Real" = Electron + CDP/screenshot, feito em 2026-10-15 com `TERACOTA_AGENT_PANEL=1 TERACOTA_AGENT_PANEL_SIM=1`. Screenshots em `reports/agent-bridge/shots/`.

| Item | real (Electron+CDP/screenshot) | automatizado (Vitest) | não homologado |
| --- | --- | --- | --- |
| Abertura do painel | ok: abre ao iniciar com SIM=1 (`r01`); item do menu nativo **não clicado** | ipc/window (`panel/*.test.ts`) | fluxo com Claude real |
| Layout em diferentes dimensões | ok: 320×420 (mínimo), 400×600 e 720×900, sem overflow horizontal (`17-*`) | - | - |
| Seleção de pasta (simulada: pasta temporária) | ok no simulado; diálogo nativo **não exercitado** | `ipc.test.ts` (pickFolder recebe providerId) | diálogo do sistema com Claude |
| Estados vazios e mensagens | ok após correção (`r01`, `02`): estado vazio e motivo do Claude indisponível | - | - |
| Sessão simulada | ok (`04`) | `simulated.test.ts` | - |
| Resposta em streaming simulada | ok: texto parcial com "Processando…" (`07`) | `simulated.test.ts` | streaming real |
| Permitir / Recusar | ok (`09`) | `simulated.test.ts`, `manager.test.ts` | permissões reais |
| Interromper | ok (`08`) | `simulated.test.ts`, `bridge-provider.test.ts` | interrupção com agente real |
| Recolher e reabrir | ok: esconde e reabre (via `show()` pelo inspector do main) com o mesmo histórico e a mesma sessão; o reload do renderer reidrata (`13`) | `window.test.ts` | - |
| Encerrar | ok após correção (`r02`) | `manager.test.ts`, `simulated.test.ts` | - |
| Erros e estados desconectados | ok (`11`, `14`) | `simulated.test.ts` (`/erro`, `/desconectar`) | falhas reais do SDK |
| Reação da Tera aos eventos | ok na Tera clássica (`*b-tera-*`); o Mini Companion **não reage** (limitação) | `companion-link.test.ts`, `manager.test.ts` | - |
| Fluxo com Claude (SDK) | não homologado | testes com SDK dublado | **sem ANTHROPIC_API_KEY e smoke real, não afirmar** |

Controles do painel têm `data-testid` estável: `provider-select`, `pick-folder`,
`session-select`, `new-session`, `prompt`, `send`, `interrupt`, `allow`, `deny`, `collapse`,
`collapse-idle`, `end-session`, `state`, `error`, `history`, `permission`, `sim-banner`.

## Mapeamento para a Tera

`src/main/bridge/companion-link.ts`. A origem do sinal é `{ provider: id do provider, sessionId:
handle da sessão, project: nome da pasta }`. Nenhum sinal contém texto do usuário nem do agente
(nem mensagens de erro).

| Evento do bridge | Sinal para a Tera |
| --- | --- |
| Sessão iniciada (primeiro `idle`) | `lifecycle: start`, `attention` 3 s, "Sessão iniciada no painel." |
| Agente trabalhando (`running`) | `working`, `thinking` |
| Ferramenta (`tool`) | `working`, estado da ferramenta (mesma tabela dos hooks) ou `thinking` |
| Aguardando permissão | `working`, `attention`, "Preciso da sua permissão no painel." |
| Resposta recebida (primeiro `text-delta` do turno) | `working`, `typing` (deltas seguintes e `message` ignorados) |
| Turno concluído | `working: false`, `happy`, "Pronto!" |
| Erro | `working: false`, `error`, "Hmm, deu erro." |
| Turno interrompido | `working: false`, `idle`, "Interrompido." |
| Sessão encerrada | `lifecycle: end`, `working: false`, `sleeping`, "Até mais! 💤" |

Sessões do painel e sessões externas (hooks) coexistem como sessões distintas; encerrar uma
não encerra a outra.

## Smoke futuro (chamada paga real)

**Não executar sem autorização explícita.** Nada aqui cria ou exige uma chave.

- **Fornecer `ANTHROPIC_API_KEY`**: apenas na variável de ambiente da sessão do terminal, nunca
  em arquivo versionado nem `.env`, nunca em log:
  ```powershell
  $env:ANTHROPIC_API_KEY = Read-Host 'Chave'   # digitada, não fica no histórico
  # ... rodar o smoke ...
  Remove-Item Env:ANTHROPIC_API_KEY            # ao terminar
  ```
- **Limites de custo e tokens** (valores reais em `scripts/agent-smoke.ts`): prompt mínimo
  ("Responda apenas: ok"), 1 turno (`maxTurns: 1`), `maxBudgetUsd: 0.05`, modelo `haiku`, 60 s
  no total, todas as permissões negadas, sem retry, pasta temporária vazia. Defina também um
  teto de gasto próprio no Console da Anthropic e confira o consumo lá depois da execução; o
  orçamento do SDK é uma salvaguarda, não um limite contratual.
- **Comando**: `node build.mjs; node dist/scripts/agent-smoke.js`
- **Resultado esperado**: `estado: init · apiKeySource=ANTHROPIC_API_KEY`, depois
  `estado: concluído`, `total_cost_usd` na casa de centavos ou menos, contagem de tokens de
  entrada/saída e o texto final ("ok" ou equivalente). Código de saída 0. `apiKeySource` diferente
  aborta com código 3 (sem login de assinatura).
- **Interromper**: botão Interromper no painel; Encerrar sessão; fechar o app; `Ctrl+C` no smoke
  (o script limpa a pasta temporária); em último caso, revogar a chave no Console.
- **Limitações de distribuição do SDK**: pelos termos do Agent SDK, apps de terceiros usam
  chave de API; é proibido oferecer o login da assinatura Claude Code sem aprovação da
  Anthropic, e este projeto não usa a assinatura como substituto. O SDK agora é dependência
  de produção do app (`apps/desktop`) e vai no pacote, sem o binário do Claude Code que vem
  junto (o provider usa o `claude` do PATH). A conversa só fica disponível com
  `ANTHROPIC_API_KEY` no ambiente.

## Arquitetura futura: provedores alternativos

O painel só conhece a interface `AgentProvider` (`packages/agent-bridge/src/types.ts`): disponibilidade,
listagem de sessões e `start` que devolve uma `ProviderSession` (send, permissão, interromper,
fechar). Outros agentes entram como novos providers em `apps/desktop/src/main/integrations/<agente>/`,
registrados em `BRIDGE_PROVIDERS`, sem mudar o painel nem o core: outros SDKs ou CLIs de agentes,
endpoints compatíveis com APIs de modelos, ou modelo local. Todos reutilizam o mesmo
`companion-link` (a Tera reage igual) e as mesmas regras: consentimento para ações sensíveis,
IPC validado, nada de bypass de permissão e nenhum prompt em log.
