---
description: Arquitetura de adapters do Teracota, capabilities, status por agente e como integrar um agente novo.
---

# Integrações com agentes

O Teracota não é preso ao Claude Code. A arquitetura suporta vários agentes de
programação por meio de **adapters** independentes. O objetivo de longo prazo:

> **Connect your coding agent and give it a life on your desktop.**
> Em vez de "Desktop pet for Claude Code".

O Claude Code continua sendo a integração de primeira classe, mas o Teracota passa a
ser independente de fornecedor.

```
                         TERACOTA
                             │
                      Companion Core
              (manager, sessões, Teras, renderer)
                             │
                   AgentSignal / CompanionEvent
                             │
        ┌──────────────┬─────┴────────┬──────────────────┐
        ▼              ▼              ▼                  ▼
 Claude Code      Codex adapter   OpenCode adapter   API local universal
   adapter        (planejado)     (planejado)        (qualquer ferramenta)
        │              │              │                  │
        ▼              ▼              ▼                  ▼
   Claude Code    OpenAI Codex     OpenCode        "Meu agente"
```

## Regra principal

**Nenhum comportamento específico de um agente entra no core, no renderer ou no
`Character`.** Cada integração traduz os eventos nativos do seu agente pro protocolo
normalizado do Teracota:

```
Claude Code                               OpenCode (planejado)
PreToolUse(Edit)                          tool.execute.before
      ↓                                         ↓
ClaudeCodeAdapter                         OpenCodeAdapter
      ↓                                         ↓
AgentSignal { source, working: true,      AgentSignal { source, working: true,
  event: { state: "typing" } }              event: { state: "typing" } }
```

O renderer não sabe qual agente originou o evento. Nada de `isClaude`, `isCodex`,
`isOpenCode` espalhado pelo código. Essa regra é **verificada por teste**
(`src/main/integrations/integrations.test.ts`): o CI falha se algo específico de um
agente aparecer fora de `src/main/integrations/`.

## Como está implementado hoje

```
src/main/integrations/
  types.ts                  contrato: AgentAdapter, AgentSignal, AgentCapabilities
  index.ts                  registro dos adapters + capabilities das integrações da comunidade
  claude-code/
    adapter.ts              hooks do Claude Code → AgentSignal
    connect.ts              conexão pela CLI: instala o plugin; liga/desliga as falas pelo MCP
    adapter.test.ts
```

### O contrato (`types.ts`)

```ts
interface AgentAdapter {
  id: string;                        // slug estável: "claude-code"
  displayName: string;               // "Claude Code" (aparece no balão/plaquinha)
  capabilities: AgentCapabilities;
  routes: string[];                  // rotas HTTP locais que recebem os eventos nativos
  toSignal(body: unknown): AgentSignal | null;
  connect?: AgentConnector;          // opcional: itens no menu (conectar, sessões abertas, falas)
}

interface AgentSignal {
  source: { provider: string; sessionId: string; project: string };
  lifecycle?: 'start' | 'end';       // começo/fim da sessão
  working?: boolean;                 // começou/terminou de trabalhar
  mcpCall?: boolean;                 // a próxima chamada MCP vem desta sessão
  event: CompanionEvent | null;      // o que mostrar (estado, fala...)
}
```

O core (`manager.ts`) só recebe `AgentSignal`s: rastreia a sessão pela chave
`provider:sessionId`, decide qual Tera mostra o quê (modo uma só ou uma por sessão) e
monta a etiqueta de origem. Com agentes diferentes abertos ao mesmo tempo, o balão e a
plaquinha mostram **"Agente · projeto"** (ex.: `Claude Code · api`, `Codex · hera`).
Com um só agente, só o projeto.

## Modelo de capabilities

Nem todo agente tem os mesmos eventos. Cada adapter **declara** o que consegue
informar, e o Teracota oferece a melhor experiência possível com isso, sem fingir
features que não existem.

```ts
interface AgentCapabilities {
  sessions: boolean;      // identifica sessões e projeto → uma Tera por sessão
  toolEvents: boolean;    // lendo, editando, terminal...
  fileEvents: boolean;    // arquivos editados
  permissions: boolean;   // pediu permissão → Tera acena
  errors: boolean;        // falhas → Tera confusa
  completion: boolean;    // terminou → Tera comemora
  messages: boolean;      // mensagens do usuário/agente
  mcp: boolean;           // fala com o MCP do Teracota (say/emote)
}
```

Hoje as capabilities já mudam o comportamento: **sem `completion`**, o "trabalhando"
expira depois de 1 min sem eventos (em vez de 10), pra Tera não ficar presa trabalhando
pra sempre. As próximas integrações devem acrescentar usos conforme a necessidade
real aparecer.

| | Claude Code | Integração da comunidade (API local) |
|---|:-:|:-:|
| Sessões | ✓ | ✓ (se mandar `source`) |
| Ferramentas | ✓ | — |
| Arquivos | — (chegam como ferramenta) | — |
| Permissões | ✓ | — |
| Erros | ✓ | — |
| Conclusão | ✓ | — |
| Mensagens | ✓ | — |
| MCP | ✓ | — |

## Status por agente

### Claude Code: **SUPORTADO** (integração de referência)

Plugin com hooks via `curl`; falas pelo MCP (servido pelo app) são opcionais e ficam
fora do plugin, pra não gerar erro com o app fechado. Preservar: hooks, MCP, sessões,
permissões, atividade de ferramentas, várias sessões, `say` e `emote`.

### OpenAI Codex: **PLANEJADO, prioridade alta**

- Investigar as interfaces oficiais disponíveis no momento da implementação.
- Priorizar eventos equivalentes a: sessão iniciada, pensando, lendo, editando,
  executando comando, permissão necessária, erro, tarefa concluída, sessão encerrada.
- Implementar **só com interfaces estáveis ou razoavelmente suportadas**. Não depender
  de ler a UI/TUI quando houver integração oficial melhor.
- **Não anunciar suporte antes de validar o fluxo real.**

### OpenCode: **PLANEJADO, prioridade alta**

O OpenCode tem uma arquitetura de plugins e eventos adequada. A integração deve ser um
**plugin do OpenCode**, sem modificar o OpenCode. Mapeamento inicial:

| Evento do OpenCode | Sinal |
|---|---|
| `session.created` | `lifecycle: 'start'` |
| `session.status` | `working` conforme o status |
| `session.error` | `state: 'error'` |
| `tool.execute.before` | `working: true` + estado pela ferramenta (`typing`, `terminal`...) |
| `tool.execute.after` | — (ou volta a `thinking`) |
| `file.edited` | `state: 'typing'` |
| `permission.asked` | `state: 'attention'` + "Tô esperando você!" |
| `permission.replied` | volta ao estado anterior |

## Checklist antes de integrar um agente novo

1. Existe API, plugin ou hook **oficial**?
2. Existem eventos de sessão?
3. Existem eventos de ferramentas?
4. Existem eventos de permissão?
5. Dá pra identificar o projeto ou workspace?
6. Dá pra detectar a conclusão?
7. A integração funciona **sem runtime externo obrigatório** na máquina do usuário?
8. O agente continua funcionando normalmente com o Teracota **fechado**?

Se as respostas forem insuficientes, **não implementar ainda**. Nesse meio-tempo, a
[API local](./api) já permite uma integração não oficial.

## Escrevendo um adapter

1. Crie `src/main/integrations/<agente>/adapter.ts` exportando um `AgentAdapter`.
2. Escolha uma rota própria, ex.: `/integrations/<agente>`. O servidor registra as
   rotas de todos os adapters automaticamente.
3. Em `toSignal`, valide o JSON nativo e traduza pra `AgentSignal`. **Nunca lance erro**:
   devolva `null` pra ignorar. O agente nunca pode ser atrapalhado.
4. Declare as capabilities com honestidade.
5. Registre em `ADAPTERS` (`src/main/integrations/index.ts`).
6. Do lado do agente (plugin, hook, extensão), mande os eventos por HTTP pra
   `127.0.0.1:7777/<sua rota>`, com timeout curto e falha silenciosa se o app estiver
   fechado. Evite exigir Node ou Python na máquina do usuário.
7. Se o agente tiver como instalar a integração por CLI, implemente `connect`: o menu
   ganha "Conectar ao &lt;agente&gt;" sozinho.
8. Pra interface: em `toSignal`, preencha `activity` (o que a sessão está fazendo, com um
   detalhe curto como o nome do arquivo) e `request` (o agente precisa do usuário:
   permissão ou pergunta, com as alternativas; `null` quando a sessão segue). Dê um
   `badge` (sigla e cor do ícone).
9. Se o agente informa limites de uso do plano, implemente `usage` (rota própria, `parse` e
   ligar/desligar): a interface ganha o chip da IA e o item nos Ajustes sozinha.
10. Escreva testes de `toSignal` (veja `apps/desktop/src/main/integrations/claude-code/adapter.test.ts`) e rode `pnpm check`.

## API local universal

`POST /api/v1/event` (com `/event` como alias compatível) aceita um `CompanionEvent` e,
opcionalmente, um `source`. **Com `source`, a ferramenta ganha sessões, etiqueta de
origem e uma Tera própria no modo "uma por sessão"**, sem adapter oficial. Especificação
completa em [API local](./api).

## Adapters da comunidade

Objetivo futuro: a comunidade escrever adapters sem modificar o core. Por enquanto, a
estrutura é `src/main/integrations/<agente>/`. Mais tarde isso pode virar plugins
externos (`teracota-adapter-foo`).

**Não implementar um runtime de plugins agora.** Primeiro, validar pelo menos três
integrações reais (Claude Code, Codex e OpenCode). Depois, extrair uma API pública
baseada no que elas realmente precisaram. Nada de desenhar SDK em cima de hipóteses.

## Marcos

1. **Companion Core:** ✅ arquitetura de adapters, capabilities, identidade do agente e
   API local v1, todos na primeira beta pública (v0.1). O Claude Code continua sendo a
   única integração oficial.
2. **v0.2 a v0.4:** sessões de foco, melhorias visuais e várias Teras. Essas versões não
   esperam por agentes novos.
3. **Adapter #2:** OpenCode ou Codex, o que tiver a integração oficial mais madura na
   hora. Objetivo: validar que a arquitetura de adapters funciona de verdade.
4. **Adapter #3:** o outro. Objetivo: validar a abstração com três sistemas diferentes.
5. **Adapter SDK:** API pública mínima pra integrações da comunidade, só depois de
   aprender com os três.
