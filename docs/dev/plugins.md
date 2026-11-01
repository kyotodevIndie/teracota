# Plugins da Tera — especificação (proposta)

> Estado: **primeira versão implementada** (cartões, fala, sessões de agente, limites de
> uso, eventos por HTTP, ajustes e permissões). Exemplo pronto: `examples/plugins/pomodoro`.
> O resto desta página é o plano; "Como escrever um plugin hoje" logo abaixo é o que vale.

## Como escrever um plugin hoje

Uma pasta dentro da pasta de plugins (Ajustes → Plugins → "Abrir a pasta de plugins"; em
desenvolvimento dá pra apontar outra com `TERACOTA_PLUGINS_DIR`), com:

`teracota-plugin.json`:

```json
{
  "id": "pomodoro",
  "name": "Pomodoro",
  "version": "0.1.0",
  "description": "Ciclos de foco e pausa",
  "main": "main.js",
  "permissions": ["say", "cards", "http"],
  "badge": { "text": "🍅", "color": "#e5484d" },
  "settings": [{ "key": "foco", "label": "Minutos de foco", "type": "number", "default": 25, "min": 1, "max": 120 }]
}
```

`main.js`: JavaScript comum, que roda numa página escondida e isolada (sem Node, sem
arquivos, sem abrir janelas; rede só `https` pros hosts declarados em `network:<host>`).
Só fala com a Tera pelo objeto `tera`:

| API | Permissão | O que faz |
|---|---|---|
| `tera.say(texto, { expression })` | `say` | A Tera fala (no máximo uma vez a cada 3 s) |
| `tera.card.set(id, { title, line, level, progress })` / `tera.card.remove(id)` | `cards` | Cartão na pilha "Agora" (até 5 por plugin); `level`: `normal`, `attention`, `done`; `progress` de 0 a 1 |
| `tera.session.update(id, { project, working, activity, request })` / `tera.session.end(id)` | `agent` | Sessão de um agente, igual às do Claude Code (`request` = pergunta pro usuário) |
| `tera.usage.set([{ id: 'five_hour', usedPct, resetsAt }])` | `agent` | Chip de limite do plugin no topo |
| `tera.onHttp(({ path, body }) => …)` | `http` | Recebe `POST 127.0.0.1:7777/plugins/<id>/<path>` |
| `tera.settings`, `tera.onSettings(cb)` | — | Valores dos ajustes declarados no manifesto |
| `tera.log(texto)` | — | Escreve no log do app |

Ligar um plugin mostra as permissões em português e pede aprovação; se uma versão nova
pedir mais permissões, ele fica desligado até o usuário aprovar de novo. Mais de 30
chamadas por segundo são descartadas; um plugin que trava vira um erro nos Ajustes.

O que mudou em relação ao plano: o plugin **não desenha** (sem `ui.html`): manda dados e a
Tera desenha com os componentes dela (cartão, chip, ajustes), o que já segue o tema e evita
HTML de terceiros na interface. O Claude Code continua como integração embutida, porque
precisa de Node (instala o plugin dele, mexe no `settings.json`), o que um plugin isolado
não tem.

Plugins estendem a Tera sem mexer no código dela: conectam novas IAs, põem cartões e abas
na interface, fazem a Tera reagir e trazem skins. Plugin é código de terceiros, então a
regra que guia tudo é: **um plugin só faz o que declarou, o usuário aprovou, e um plugin
com problema não derruba a Tera**.

## O que já existe e vira base

- `AgentAdapter` (`apps/desktop/src/main/integrations/types.ts`) já é um "plugin embutido":
  traduz eventos de uma IA em sinais normalizados (sessão, atividade, pedido), tem `badge`,
  `connect` e `usage`. A interface e o core já não conhecem nenhuma IA pelo nome (há um
  teste que garante isso).
- A API local (`POST /api/v1/event`) já aceita eventos de qualquer ferramenta.
- Skins já são pastas com manifesto (`assets/skins/*`).

O primeiro passo dos plugins é **transformar o Claude Code no primeiro plugin embutido**,
usando a mesma API que os de fora vão usar. Se a API não serve pro Claude Code, não serve
pra ninguém.

## Pontos de extensão

| Ponto | O que o plugin faz | Exemplo |
|---|---|---|
| `agent` | Conecta uma IA: recebe os eventos dela e entrega sessões, atividade, pedidos e limites de uso | Codex, Antigravity, OpenCode |
| `ui.card` | Um cartão na pilha "Agora" (atualizado pelo plugin) | build do CI, deploy em andamento |
| `ui.tab` | Uma aba própria (entra em "Mais" quando a barra lotar) | painel de PRs |
| `ui.settings` | Uma seção nos Ajustes | opções do próprio plugin |
| `ui.chip` | Um chip no topo, com balão | fila do CI, cota de outra API |
| `tera` | Faz a Tera falar, mudar de pose/expressão, reagir a eventos | "Pomodoro acabou!" |
| `skin` | Pacote de visual da Tera (já existe como pasta) | skins da comunidade |
| `command` | Itens no menu da Tera e na bandeja | "Abrir o projeto atual" |

## Formato

Um plugin é uma pasta (ou um `.zip` com ela) com um manifesto:

```json
{
  "id": "codex",
  "name": "Codex",
  "version": "0.1.0",
  "tera": ">=0.2",
  "author": "…",
  "contributes": {
    "agent": { "badge": { "text": "Cx", "color": "#3f8f7a" }, "routes": ["/integrations/codex"] },
    "ui.card": [{ "id": "status" }],
    "ui.settings": true
  },
  "permissions": ["network:api.openai.com", "notifications"],
  "main": "main.js",
  "ui": "ui.html"
}
```

- `main`: a lógica (JS). Roda num processo separado (Electron `utilityProcess`), sem acesso
  direto ao Node além do que as permissões liberarem.
- `ui`: a parte visual. Roda isolada (iframe em sandbox, sem Node, CSP sem rede) e conversa
  com a Tera por mensagens. Desenha com os componentes da Tera (cartão, chip, botão, barra
  de limite), pra tudo ficar com a mesma cara e respeitar o tema escolhido.
- Plugins que não querem escrever JS podem só mandar HTTP pra API local (como o plugin do
  Claude Code faz hoje com `curl`): aí só `agent` e `tera` valem.

## API (rascunho)

Do lado `main` do plugin, um objeto `tera`:

```ts
tera.sessions.update({ id, project, working, activity, request })   // ponto agent
tera.sessions.end(id)
tera.usage.set([{ id: 'five_hour', usedPct: 42, resetsAt }])         // chip da IA
tera.say('Pronto!', { pose: 'happy' })                               // ponto tera
tera.ui.card('status').set({ title, line, level })                   // ponto ui.card
tera.settings.get() / tera.settings.onChange(cb)
tera.http.route('/integrations/codex', (body) => …)                  // eventos nativos da IA
```

Tudo é assíncrono, validado do lado da Tera e com limite de frequência.

## Segurança

- **Permissões declaradas e aprovadas na instalação.** A Tera mostra a lista em português
  ("acessar api.openai.com", "ler arquivos da pasta do projeto") e o usuário aprova. Pedir
  uma permissão nova numa atualização pede aprovação de novo.
- **Sem segredos à vista**: plugins não leem o login das IAs nem o `settings.json` delas.
  Se um plugin precisa de chave, ela fica no cofre do sistema (`safeStorage`) e só o
  próprio plugin lê.
- **Isolamento**: a UI do plugin não toca no DOM da Tera nem na de outro plugin; o `main`
  roda fora do processo principal. Plugin que trava ou passa do limite de CPU/memória é
  desligado, e a Tera avisa.
- **Responder pedidos de permissão das IAs** (Permitir/Negar pela Tera) **não** é dado a
  plugins de terceiros: é a parte mais sensível e fica no core, com revisão própria.
- Origem: no começo, só pasta local (modo desenvolvedor). Lista oficial/loja só depois, com
  assinatura dos pacotes.

## Plano

1. **Claude Code como plugin embutido**: extrair a API acima a partir do `AgentAdapter` atual,
   sem mudar o comportamento (os testes de hoje continuam passando).
2. Carregador de plugins locais (pasta `plugins/` nos dados do app), com manifesto validado,
   permissões e ligar/desligar nos Ajustes.
3. Pontos `ui.card`, `ui.chip` e `ui.settings` com os componentes da Tera.
4. Um plugin de exemplo de fora (ex.: Codex ou um "CI status") pra validar a API.
5. Só então: `ui.tab`, `command`, empacotamento `.zip` e lista oficial.

## Em aberto (decisão do dono)

- **Barra de baixo cheia**: aba de plugin vai pra uma aba "Mais", ou plugin só entra como
  cartão na pilha?
- **De onde vêm os plugins**: só pasta local no começo, ou já planejar a lista oficial?
- **Linguagem**: só JS/TS, ou também qualquer linguagem via HTTP (o que limita aos pontos
  `agent` e `tera`)?
- **Responder pedidos pela Tera** (Permitir/Negar e escolher a alternativa sem ir ao
  terminal): vale fazer no core? Exige um hook do Claude Code que espera a resposta da Tera,
  e uma revisão de segurança antes (qualquer processo local poderia tentar responder).
