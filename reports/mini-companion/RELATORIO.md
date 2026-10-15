# Mini Companion: auditoria e protótipo visual (etapas 1 e 2)

> Branch `feat/mini-companion`, sem commit. Data: 2026-10-04.
> Escopo desta entrega: **auditoria + protótipo com eventos simulados**. Os hooks reais
> **não** foram conectados à janela nova (etapa 3), como combinado.

## Etapa 1: auditoria

### Arquitetura atual

| Peça | Onde | O que faz | Reaproveitável pro mini? |
|---|---|---|---|
| Janela da Tera | `src/main/entity.ts` | Janela transparente, sempre no topo, que deixa o clique passar (`setIgnoreMouseEvents` + `forward`). Lê a posição do cursor a cada 33 ms porque os eventos de mouse repassados não são confiáveis no Windows. Usa `setBounds` (DPI) e `showInactive`, que não rouba o foco. | **Sim, o padrão inteiro.** A janela nova copia a mesma técnica. |
| Roteamento | `src/main/manager.ts` | Uma Tera ou uma por sessão. Chave de sessão `provider:sessionId`. Etiqueta "Agente · projeto". | Sim. O mini vai consumir os mesmos sinais na etapa 3. |
| Sessões | `src/main/sessions.ts` | `SessionTracker`: `working`, `lastSeen`, expiração. | Sim, como está. |
| Hooks → sinais | `src/main/integrations/claude-code/adapter.ts` | JSON do hook → `AgentSignal` (já normalizado; o core não conhece o Claude Code). | Sim, mas faltam dados (abaixo). |
| Servidor | `src/main/server.ts` | `/hook`, `/api/v1/event`, MCP. Só `127.0.0.1`, recusa `Origin`. | Sim, sem mudança. |
| Notificações | — | **Não existe sistema central.** Hoje um evento só vira balão de fala da Tera e some. | **Criado agora** (`companion/notifications.ts`). |
| Personagem | `src/renderer/sprite-character.ts`, `assets/skins/tera` | Frames 260 px por pose (idle, work, think, happy, error, surprised, wave...). | Sim: o mini usa os mesmos frames, recortados na metade de cima. |
| Menu e bandeja | `src/main/menu.ts`, `main.ts` | Menu único (botão direito da Tera e da bandeja). | Sim. O menu é o "painel completo" (ver decisões). |
| Config | `src/main/config.ts` | JSON em `%APPDATA%`. | Ganhou 3 campos opcionais. |

### O que os hooks dão hoje e o que falta (pra etapa 3)

Documentação oficial de hooks, consultada em 2026-10-04.

| Necessidade do mini | Situação |
|---|---|
| Atividade, sessão, projeto, fim de tarefa, erro | **Já chega** (`PreToolUse`, `Stop`, `PostToolUseFailure`, `SessionStart/End`). |
| **Pedido de permissão com detalhes** (ferramenta, comando) | **Não chega hoje.** O plugin não registra o hook `PermissionRequest`, que dispara na hora e traz `tool_name` + `tool_input`. Hoje só chega o `Notification`, que dispara **~6 s depois** e só se o usuário não estiver digitando. O adapter ainda **descarta** o `message` e o `notification_type` dele. |
| Pergunta do agente | Não há um hook específico pra perguntas comuns. `Notification` com `idle_prompt` chega ~60 s depois. Diálogos de MCP chegam via `elicitation_dialog`. |
| **Saber que a permissão foi respondida** | **Não existe evento.** Dá pra inferir: o próximo `PreToolUse`/`Stop`/`UserPromptSubmit` da mesma sessão significa que ela seguiu em frente (`resolveSession`). É uma heurística, e fica documentado como tal. |
| Responder a permissão pela Teracota | **Categoria 2.** Tecnicamente, um hook `PermissionRequest` pode devolver `allow`/`deny`. Mas ele **bloqueia** o diálogo do terminal enquanto espera, e aprovar remotamente é sensível. **Não implementado e não proposto sem a sua aprovação.** |

Pra etapa 3, o plugin precisa de uma versão nova (registrar `PermissionRequest`), e quem já
instalou precisa atualizar o plugin. O adapter precisa repassar `message`, `notification_type`,
`tool_name` e um resumo curto do `tool_input`.

### As 3 categorias

- **Monitoramento (dá com hooks):** atividade, sessões, erros, conclusão, aviso de permissão (com detalhes, depois de registrar `PermissionRequest`), aviso "esperando você".
- **Interação experimental (depende da POC do Agent SDK + termos da Anthropic):** enviar mensagem, aprovar/recusar, responder pergunta, enviar arquivos, abrir/retomar sessão. **Nada disso está na janela.**
- **Indisponível:** assumir uma sessão que já está aberta no terminal; focar a janela exata do terminal da sessão (não há API pra isso); saber com certeza que uma permissão foi respondida.

## Etapa 2: protótipo (o que foi feito)

### Arquivos

```
src/shared/companion.ts            contrato main ↔ janela (CompanionView, ações, IPC)
src/main/companion/
  visual-state.ts                  máquina de estados (pura) + prioridades
  notifications.ts                 fila central (pura): prioridade, agrupamento, expiração
  controller.ts                    junta tudo, deriva o estado, monta o view (sem Electron)
  window.ts                        janela fixa transparente, âncora, posição, multi-monitor
  simulator.ts                     eventos simulados (só em desenvolvimento)
  index.ts                         liga janela + controller + IPC
src/main/ui-mode.ts                alterna Tera completa ↔ Mini
src/preload/companion-preload.ts
src/renderer/companion.{html,css,ts}
```

**Mudanças no código existente (pequenas e reversíveis):**
- `config.ts`: campos `ui`, `companion`, `companionMuted`.
- `manager.ts`: `setSuppressed` esconde as Teras completas no modo mini, e elas **continuam recebendo eventos**. Ganhou também `settings`, `saveSettings` e `onVisibilityChange`.
- `menu.ts`: submenu **Visual** (Tera completa / Mini experimental) e **Simular (mini)** (só em dev). "Voltar pro canto" também vale pro mini.
- `main.ts`: registra o IPC e chama `initUi`.
- `build.mjs`: entradas novas.

### Decisões de projeto

- **Máquina de estados sem combinações inválidas.** O estado visual é **um valor derivado** de fatos independentes (mouse em cima, fixada, arrastando arquivo, menu aberto, há pendência, recolhida, silenciado, trabalhando). Prioridade:
  1. `ATTENTION`: solicitação pendente; não recolhe sozinha.
  2. `PANEL`: menu aberto.
  3. `DRAGGING`
  4. `EXPANDED`: hover/clique.
  5. `NOTIFICATION`: erro/conclusão, temporária e silenciável.
  6. `WORKING`: só um indicador.
  7. `MINI`
- **Ordem diferente da do documento:** coloquei arrastar arquivo acima da interação comum, porque arrastar *é* uma interação mais específica. A solicitação pendente continua vencendo tudo.
- **A janela não muda de tamanho.** Ela já nasce do tamanho da barra (448×116), e só o cartão anima (CSS). Redimensionar janela transparente a cada quadro no Windows treme e erra a escala entre monitores. Fora do cartão o clique atravessa, então a área vazia não bloqueia nada.
- **Âncora:** a barra abre pro lado com mais espaço. Perto da borda direita ela abre pra esquerda, e o quadrado da Tera fica parado no mesmo lugar.
- **Foco:** a janela aparece com `showInactive` e expande sozinha **sem roubar o foco**. Só recebe foco quando você clica nela.
- **Nenhum botão que não funciona.**
  - Na permissão, a única ação é "Vou ver no terminal": marca como encaminhada e a resposta é dada lá.
  - Não há botão de aprovar.
  - O campo de entrada do modo expandido virou informação de contexto, porque enviar mensagem não é suportado (categoria 2).
- **Soltar arquivos é honesto:** a área de soltar diz "O envio pra sessão ainda não está disponível". Ao soltar, aparece "Arquivos não enviados... Nada foi enviado (nomes)".
- **"Painel existente":** a Teracota não tem um painel. Tratei como o menu completo (estado `PANEL`) mais a volta pra Tera completa (menu → Visual). Se você pensava em outra coisa, me diz.
- **Modo mini como padrão:** **ainda não**. Ele está no menu como "Mini (experimental)" e o padrão continua sendo a Tera completa, até você validar. Trocar o padrão é uma linha.
- **Silenciar:** erro, conclusão e aviso não expandem sozinhos. Solicitação **não** é silenciável.
- **Várias solicitações:** todas ficam na fila. Navegação ‹ 1/3 ›, a mais antiga primeiro, badge com o total quando recolhida. Uma solicitação nova reabre a atenção.
- **Agrupamento:** o mesmo evento da mesma sessão em menos de 10 s vira um, com "×N". Sessões diferentes nunca se misturam.

### Validado (com evidência)

**Automatizado:** `npm run check` passou (typecheck, lint e **167 testes**, 44 novos):
- `visual-state.test.ts` (9): prioridades, silenciar, recolher.
- `notifications.test.ts` (8): pendência não expira, ordem, agrupamento, sessões separadas, limite que nunca descarta pendências.
- `controller.test.ts` (14): hover com atraso, clique, atenção persistente, só ações reais, navegação, "vou ver no terminal", conclusão que expira, silenciar, soltar sem fingir envio.
- `window.test.ts` (3): âncora, quadrado parado ao trocar de lado, limite da tela (incluindo monitor com coordenadas negativas).

**Na janela real (Windows, app em perfil isolado, porta 7791):** os estados foram dirigidos pelo DevTools e capturados da tela de verdade.
- Imagens em `reports/mini-companion/`; `estados.png` junta tudo.
- Estados e transições: mini, trabalhando, expandido, atenção com 5 itens na fila e navegação, recolhida com badge, erro, conclusão (recolhe sozinha em ~5 s), arrastar e soltar.
- Erro repetido 3× virou "×3". Silenciado, a conclusão não expandiu.
- O botão real "Vou ver no terminal", clicado no DOM, resolveu e recolheu.
- **Lado esquerdo:** abre pra direita (`f-9-lado-esquerdo.png`).
- **Segundo monitor** (2560×1440, coordenadas negativas): funcionou (`f-10-segundo-monitor.png`).
- **Posição:** salva ao soltar e restaurada ao reabrir.

### Não validado (precisa de você)

Esses testes dependem do **mouse físico**, e eu não movi o seu cursor:
- **Hover real** (cursor → teste de área → clique atravessa). É o mesmo mecanismo da Tera completa, mas não foi exercitado com o cursor físico.
- **Clicar na Tera** pra fixar/soltar, e **arrastar a janela com o mouse**.
- **Arrastar arquivos de verdade do Explorer.** O Windows precisa entregar o *drag* a uma janela que estava deixando o clique passar.
- **Escalas diferentes:** os seus dois monitores estão em 100%. Não testei 125%/150%.
- **Foco:** expandir sozinha não roubar o foco do editor. Usa `showInactive`, mas não verifiquei digitando em outro app.
- Teclado (Tab/Enter nos botões) e leitor de tela.
- Reiniciar o app com solicitações pendentes: elas **não** são persistidas, de propósito, porque os hooks reais vão reenviar o estado.

### Limitações e pendências conhecidas

- Algumas poses (ex.: `work`) têm a personagem mais baixa no frame, então o rosto fica mais cortado no quadrado. Isso pede um ajuste de enquadramento por pose (offset no `skin.json`), que deixei pro redesenho.
- O texto longo é cortado com "…". Não há tela de detalhes; o menu e o terminal continuam sendo o lugar das operações completas.
- O modo "uma Tera por sessão" fica escondido no modo mini. O mini mostra todas as sessões numa fila só.
- Nenhum evento real chega à janela mini ainda (etapa 3).

## Como testar

O app de desenvolvimento usa uma configuração separada da sua instalação. Use outra porta
pra não brigar com a Teracota instalada:

```bash
npm run build
```
```bash
TERACOTA_PORT=7791 npx electron .
```

No PowerShell: `$env:TERACOTA_PORT=7791; npx electron .`

1. Botão direito na Tera → **Visual → Mini (experimental)**.
2. Botão direito no quadrado → **Simular (mini)**: permissão, pergunta, erro, erro repetido, conclusão, trabalhando, "3 solicitações + erro + conclusão", resolver a mais antiga, limpar.
3. Confira:
   - passar o mouse abre;
   - clicar na Tera fixa;
   - arrastar a Tera move a janela;
   - perto da borda esquerda a barra abre pro outro lado;
   - arrastar arquivos do Explorer mostra a área de soltar;
   - a janela não rouba o foco do editor quando expande sozinha.
4. **Visual → Tera completa** volta ao normal.

## Recomendações pra próxima fase (etapa 3, depois da sua validação)

1. **Plugin:**
   - Registrar `PermissionRequest`, só como observador: responde na hora, sem decisão, e não bloqueia o terminal.
   - Subir a versão do plugin e avisar no app que é preciso atualizar.
2. **Adapter:**
   - Mapear os hooks pro mini: `Notification` (`permission_prompt`, `idle_prompt`, `elicitation_*`) com o `message` real; `PermissionRequest` com a ferramenta e um resumo seguro do comando ou caminho (cortado, sem conteúdo de arquivo); `PostToolUseFailure` → erro; `Stop` → conclusão.
   - Criar um tipo normalizado `AgentNotice`, pro core continuar sem saber de Claude Code.
3. **Resolução:** qualquer atividade nova da sessão resolve as solicitações dela (`resolveSession`). Documentar que é uma inferência.
4. **Privacidade:** o `tool_input` pode trazer segredos (comandos com tokens). Mostrar só o necessário, cortado, e nunca gravar em disco.
5. **Depois do seu ok:** decidir se o mini vira o padrão e ajustar o enquadramento por pose.
