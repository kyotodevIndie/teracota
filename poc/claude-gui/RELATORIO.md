# POC: Teracota como interface do Claude Code

> Data: 2026-10-04 · Claude Code instalado: **2.1.224** (winget) · Agent SDK: **@anthropic-ai/claude-agent-sdk 0.3.289**
> Código da POC: `poc/claude-gui/` (pacote isolado; a implementação principal da Teracota **não foi alterada**).

## Resumo

**Dá pra fazer, e pelo caminho oficial.** O Agent SDK do Claude Code (TypeScript) oferece
comunicação bidirecional completa: sessões novas e retomadas, streaming, imagens, pedidos de
permissão com aprovar/recusar, interrupção, ferramentas e arquivos alterados. Todos os
cenários testados funcionaram contra o Claude Code real, usando o login que o usuário já tem.

**O que pesa contra** não é técnico:
- **Termos de uso.** A documentação diz que produtos de terceiros feitos com o Agent SDK
  devem usar chave de API, e não o login do claude.ai (Pro/Max). Isso precisa de clareza
  antes de lançar (seção 3).
- **Uso e custo.** Cada mensagem enviada pela Teracota consome a franquia ou é cobrada na
  chave, igual ao terminal.
- **Não dá pra "entrar" numa sessão que já está aberta no terminal.** A Teracota consegue
  retomar uma sessão salva, mas não assumir o controle de uma que está rodando.

## 1. Mecanismos oficiais investigados

Fonte: documentação oficial atual (code.claude.com/docs, consultada em 2026-10-04).

| Mecanismo | Bidirecional? | Serve pra POC? | Observação |
|---|---|---|---|
| **Hooks** (o que a Teracota usa hoje) | **Não, na prática** | Não | Recebem eventos. A resposta de um hook pode bloquear ou permitir uma ação, mas não envia mensagens nem abre conversa. Confirma a premissa do pedido. |
| **Agent SDK (TypeScript/Python)** | **Sim** | **Sim (usado)** | "Claude Code como biblioteca". Roda o binário do Claude Code e conversa com ele por um protocolo de controle: `query()` com entrada em streaming, `canUseTool`, `interrupt()`, `listSessions()`, `resume`, hooks em código. |
| **CLI headless** (`claude -p --input-format stream-json --output-format stream-json`) | Sim | Sim (alternativa) | O mesmo protocolo que o SDK usa por baixo. Observado: o próprio app Claude Desktop roda `claude.exe` assim. O SDK é a forma documentada e tipada. |
| **Channels** (servidor MCP que injeta mensagens numa sessão aberta) | Sim, inclusive repassa permissões | Não por enquanto | Única forma de falar com uma sessão **já aberta no terminal**. Mas é *research preview*. Canal próprio só roda com `--dangerously-load-development-channels`, que mostra um aviso em tela cheia, e o usuário precisa iniciar o `claude` com essa flag. |
| **Remote Control** | Sim | Não | Passa pelo claude.ai ou pelo app mobile. Não há API local pública. |
| **MCP** (o que a Teracota serve hoje) | Só Claude → Teracota | Não | O Claude chama as ferramentas da Teracota (`say`/`emote`). A Teracota não consegue iniciar uma conversa. |

**Escolha:** Agent SDK, apontando pro `claude` que o usuário instalou
(`pathToClaudeCodeExecutable`), sem embutir binário. O pacote foi instalado com
`--omit=optional`, então o binário de ~250 MB que o SDK traz não veio.

## 2. Resultados (evidências em `smoke-out/report.json` e screenshots)

O teste automatizado é `npm run smoke`. Rodou contra o Claude Code real, com o modelo Haiku
e prompts mínimos. Custo estimado somado de todos os cenários: **US$ 0,14**. Na assinatura
isso não é cobrado em dinheiro, mas consome a franquia.

| # | Cenário | Resultado | Evidência |
|---|---|---|---|
| A | Sessão nova + streaming | ✅ | `apiKeySource: "none"` (usou o login do usuário, sem chave). O 1º pedaço de texto chegou em ~8,8 s, incluindo a partida do processo (~6 s até o `init`). |
| B | Listar sessões do projeto + retomar por id | ✅ | `listSessions` devolveu a sessão de A com o primeiro prompt. Ao retomar, o modelo lembrou a resposta anterior. |
| C | Pedido de permissão → **recusar** | ✅ | `canUseTool` disparou com `Write` + caminho + conteúdo + sugestões. Arquivo **não** criado. |
| D | Permissão → **aprovar**, acompanhar ferramenta e arquivo | ✅ | Estados `running → waiting-permission → running → idle`. Viu o `tool_use`, o `tool_result` e o arquivo alterado (hook `PostToolUse` em código). Arquivo criado com o conteúdo certo. |
| E | Anexar imagem (favicon da Tera, base64) | ✅ | Resposta: "Personagem chibi com cabelo laranja e orelhas felinas." |
| F | Interromper no meio do streaming | ✅ | Parou em 8 ms (`error_during_execution`). A **mesma sessão** respondeu a mensagem seguinte normalmente. |
| F2 | Interromper com permissão pendente | ✅ | O pedido pendente foi recusado, a execução parou e nenhum arquivo foi criado. |
| G | Duas sessões simultâneas em projetos diferentes | ✅ | Ids distintos, respostas corretas e independentes. |
| UI | Janela Electron experimental | ✅ | Dirigida pelo DevTools Protocol: abrir sessão → enviar → cartão de permissão → Permitir → resultado. Screenshots em `smoke-out/ui-1-permission.png` e `ui-2-done.png`. |

### Achados durante os testes

- **Segurança, real:** na 1ª versão do cenário D, o teste aprovava qualquer permissão. O
  modelo errou o caminho e gravou `C:\Users\vicen\sim.txt`, fora do projeto (o arquivo foi
  apagado). Lição: a interface tem que mostrar o caminho completo e nunca aprovar no
  automático. A versão final só aprova escrita dentro da pasta do projeto.
- O `init` (com o id da sessão) só chega **depois da primeira mensagem**. Antes disso, uma
  sessão nova não tem id.
- As sessões criadas pelo SDK são sessões normais do Claude Code: ficam em
  `~/.claude/projects/` e aparecem no `claude --resume`. O inverso também vale: dá pra
  retomar na Teracota uma sessão começada no terminal, **desde que ela não esteja aberta**.
- Com as configurações padrão (`settingSources` = todas), o SDK carrega os plugins e hooks
  do usuário. O hook do plugin da Teracota disparou nas sessões do SDK. Num produto, isso
  daria **eventos duplicados**, já que a Teracota receberia o mesmo evento pelo SDK e pelo
  hook (seção 5).
- Versões diferentes funcionaram: SDK 0.3.289 (feito pro Claude Code 2.1.289) com o CLI
  2.1.224. Recursos mais novos do SDK exigem um CLI mínimo (ex.: `permissionPrompts` pede
  2.1.259).

### Não testado (sem evidência)

- `AskUserQuestion` (perguntas de múltipla escolha do Claude). Chega pelo mesmo `canUseTool`, mas não montei a tela.
- "Sempre permitir nesta sessão" (aplicar as `suggestions`). O botão existe, mas não foi exercitado.
- Retomar sessão **pela interface**. Testado só no cenário B, pelo código.
- Anexos que não são imagem (PDF/documentos em base64) e várias imagens ao mesmo tempo.
- Sem login ou com login expirado, e o modo chave de API.
- Sessões longas (compactação), subagentes, MCPs do usuário, tarefas em segundo plano.
- O SDK empacotado no instalador (ESM dentro do asar do electron-builder).
- macOS e Linux.

## 3. Autenticação, custos e termos

**Como funciona tecnicamente:** a Teracota não toca em credenciais. Ela roda o `claude`
instalado pelo usuário, e ele autentica como sempre: login do claude.ai (Pro/Max/Team/
Enterprise), `ANTHROPIC_API_KEY`, Bedrock, Vertex ou Foundry. Na POC, `apiKeySource: "none"`
confirma que foi usado o login existente do usuário.

**O que os termos dizem (citação parcial, docs oficiais):**
- Na página do Agent SDK: terceiros não podem oferecer login do claude.ai ou os limites da
  assinatura nos seus produtos, salvo aprovação prévia, e devem usar chave de API.
- Em *Legal and compliance*: desenvolvedores não podem rotear requisições pelas credenciais
  Free/Pro/Max dos seus usuários, nem coletar ou intermediar credenciais. Mas isso "não
  impede" o usuário final de entrar no binário **não modificado** do Claude Code com a
  própria assinatura.

**Leitura:** a Teracota fica numa zona cinzenta. Ela não oferece login nem guarda
credenciais, e roda o binário oficial não modificado do próprio usuário. Por outro lado, é
um produto de terceiro feito sobre o Agent SDK, e a nota do SDK é explícita sobre usar chave
de API. **Recomendação:** antes de lançar, perguntar à Anthropic (o canal indicado é o
time de vendas, via contact-sales). Até lá, tratar o modo chave de API como o oficialmente
suportado, e o uso com assinatura como "o seu próprio Claude Code, com o seu login".

**Custos:**
- Não há custo extra da Teracota.
- Cada mensagem enviada pela Teracota consome a franquia (assinatura) ou é cobrada na chave
  (API), igual ao terminal.
- O SDK informa um custo **estimado** (`total_cost_usd`) por resposta, útil pra mostrar ao
  usuário.
- Os limites anunciados dos planos assumem "uso individual comum". Automação excessiva pode
  esbarrar neles.

**Marca:** a Teracota não pode se chamar ou se apresentar como "Claude Code". Dizer, em
texto, que "roda o Claude Code" é permitido.

## 4. Riscos

**Segurança**
- **Permissões:** a interface passa a ser quem aprova comandos e escritas. Ela precisa mostrar o pedido inteiro (comando, caminho, diff) sem truncar o que importa, nunca aprovar sozinha e escapar todo texto (a POC usa `textContent`; o renderer roda com sandbox e CSP).
- **Clique errado = ação real:** um botão "Permitir" num balão da Tera que aparece de repente é perigoso. Exigir foco e mostrar contexto.
- **Entradas de MCPs e plugins do usuário:** os nomes e textos que vêm deles não são confiáveis (o próprio SDK avisa).
- **Processo filho com os poderes do usuário:** é o mesmo modelo de risco do terminal, mas agora disparável por uma interface.

**Manutenção**
- **API do SDK grande e em evolução rápida:** versões 0.3.x, releases quase diários, recursos atrelados à versão do CLI. É preciso fixar a versão do SDK, checar a versão mínima do CLI ao iniciar e degradar quando faltar recurso.
- **Escopo:** reproduzir uma interface de chat completa (markdown, diffs, tarefas, subagentes, comandos `/`, imagens, compactação) é um produto grande, e o terminal e o Claude Desktop já fazem isso.
- **Channels** (a única forma de controlar sessões já abertas) pode mudar ou sumir, porque é *research preview*.
- **Termos:** se a Anthropic disser que não pode usar com assinatura, a função fica restrita a quem usa chave de API.

## 5. Arquitetura recomendada

```
┌──────────── Teracota (main) ────────────┐
│  Companion Core (manager, Tera, balões) │◄── AgentSignal ──┐
└───────────────▲─────────────────────────┘                  │
                │ comandos (abrir/enviar/permitir/parar)     │
┌───────────────┴──────── utilityProcess ────────────────────┴─┐
│  integrations/claude-code/driver.ts  (Agent SDK)              │
│  - sessões vivas por projeto (Map sessionId → AgentSession)   │
│  - canUseTool → pedido pendente → janela de chat / balão      │
│  - mensagens do SDK → AgentSignal (mesmo formato dos hooks)   │
└───────────────────────────▲───────────────────────────────────┘
                            │ stdio (protocolo do SDK)
                  `claude` do usuário (não modificado)
```

1. **Driver separado do observer:**
   - O adapter atual (hooks) continua sendo o jeito de **observar** qualquer sessão.
   - Um **driver** novo e opcional, em `integrations/claude-code/`, **dirige** sessões abertas pela Teracota.
   - O core ganha uma interface genérica `AgentDriver` (abrir, enviar, responder, interromper, listar). O teste que proíbe código específico de agente fora de `integrations/` continua valendo.
2. **Mesmos sinais:** o driver traduz as mensagens do SDK em `AgentSignal`, então a Tera anima igual.
   - Sessões dirigidas carregam `provider: 'claude-code'` e o mesmo `sessionId`.
   - O manager ignora o evento do hook quando já recebe o do driver pra mesma sessão. Isso evita a duplicação observada na POC.
3. **`utilityProcess`:** o SDK e as sessões rodam fora do processo principal. Uma sessão travada não congela a Tera.
4. **Interface:**
   - Uma janela de chat que abre a partir da Tera ("Conversar"), com lista de projetos e sessões.
   - A Tera continua sendo o centro: mostra estado e avisa "precisa de permissão".
   - O botão de aprovar fica na janela de chat, não no balão, por segurança.
5. **Binário:**
   - Usar o `claude` do usuário (`pathToClaudeCodeExecutable`) e checar a versão mínima.
   - Não embutir o binário no instalador: economiza ~250 MB e respeita "binário não modificado".
   - Sem login, mostrar "rode `claude` e faça login", sem nenhuma tela de login própria.
6. **Opt-in:** a função vem desligada e é ligada no menu, com explicação de uso e custos (padrão das falas por MCP).

## 6. Estimativa pra virar produto

Pra 1 dev; dias úteis de trabalho focado.

| Bloco | Esforço |
|---|---|
| Driver de produção (utilityProcess, várias sessões, versão mínima do CLI, erros e falta de login) + testes | 4–6 dias |
| Janela de chat (markdown, cartões de ferramenta, diff de edições, permissões completas com "sempre permitir", `AskUserQuestion`, imagens por arrastar/colar, interromper) | 8–12 dias |
| Sessões (listar, retomar, renomear, várias simultâneas, troca de projeto) + integração com o manager (sem duplicar eventos) | 4–6 dias |
| Empacotamento (SDK ESM no asar, electron-builder) e teste em máquina limpa | 2–3 dias |
| Segurança (revisão do fluxo de permissões), docs pt/en, FAQ de custos | 3–4 dias |
| **Total MVP** | **~4–6 semanas** |

O esforço **não** inclui:
- comandos `/`, subagentes, tarefas e compactação visíveis;
- mac/linux;
- o tempo até ter uma resposta da Anthropic sobre os termos.

**Próximo passo sugerido, se a decisão for seguir:**
1. Perguntar à Anthropic sobre o uso com assinatura.
2. Enquanto isso, manter o driver como um protótipo atrás de uma flag.
3. Fechar o escopo do MVP: o que a janela de chat precisa ter na v1 e o que fica pro terminal.

## Como rodar a POC

```bash
cd poc/claude-gui
npm install --omit=optional   # SDK sem o binário embutido
npm run smoke                 # cenários A–G contra o Claude Code real (usa sua franquia)
npm start                     # janela experimental (Electron do projeto raiz)
```

Os testes criam sessões em `~/.claude/projects/K--dev-waifu-claude-poc-claude-gui-smoke-out-*`.
Dá pra apagar essas pastas sem problema.
