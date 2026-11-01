---
description: API HTTP local do Teracota (/api/v1/event) pra qualquer ferramenta ou agente fazer a Tera reagir.
---

# API local

Qualquer ferramenta pode fazer a Tera reagir, mesmo sem um adapter oficial: basta
mandar eventos por HTTP pro app, que escuta **só em `127.0.0.1:7777`**.

```
Meu agente / script / CI local
        │  POST http://127.0.0.1:7777/api/v1/event
        ▼
    Teracota
```

## `POST /api/v1/event`

`/event` é um alias compatível. Corpo em JSON; todos os campos são opcionais, mas
precisa haver pelo menos um campo visual ou um `lifecycle`.

| Campo | Tipo | O que faz |
|---|---|---|
| `state` | ver [estados](#estados) | Atividade: define pose, expressão, animação e ícone |
| `say` | texto (até 280) | Balão de fala |
| `expression` | `neutral` `happy` `focused` `confused` `surprised` `sleepy` `sad` | Sobrescreve a expressão (ou reação passageira, sem `state`) |
| `anim` | `bob` `type` `sway` `shake` `jump` `breathe` `perk` `wave` | Sobrescreve a animação (ou reação passageira, sem `state`) |
| `duration` | ms (até 60000) | Quanto tempo até voltar ao estado base |
| `working` | boolean | A ferramenta está no meio de uma tarefa |
| `source` | objeto | De onde vem o evento (abaixo) |
| `lifecycle` | `start` \| `end` | Começo/fim da sessão (só com `source`) |

Campos inválidos são descartados em silêncio. Resposta: `204` quando aceito, `400`
quando não sobra nada válido.

### Sem `source`: evento solto

Vai pra todas as Teras. Bom pra notificações simples:

```bash
curl -X POST http://127.0.0.1:7777/api/v1/event \
  -H "Content-Type: application/json" \
  -d '{"state":"happy","say":"Deploy concluído!"}'
```

### Com `source`: sessões

```json
{ "source": { "provider": "meu-agente", "sessionId": "abc123", "project": "hera" } }
```

| Campo | Regra |
|---|---|
| `provider` | Obrigatório. Slug: minúsculas, números, `.` `_` `-`; até 40 caracteres |
| `sessionId` | Opcional (padrão `default`). Sessões diferentes = Teras diferentes no modo "uma por sessão" |
| `project` | Opcional (padrão: o provider). Aparece na plaquinha e no balão |

Com `source`, o evento entra no mesmo fluxo das integrações oficiais:

- **Modo "uma por sessão":** cada sessão ganha a sua Tera, com cor e plaquinha.
  `lifecycle: "end"` faz ela se despedir e ir embora.
- **Modo "uma Tera só":** ela agrega todas as sessões. Com mais de uma sessão aberta, o
  balão mostra a origem, e com agentes diferentes abertos, `provider · projeto`.
- **`working`:** integrações da comunidade não têm garantia de avisar quando terminam.
  Por isso, o "trabalhando" expira sozinho depois de **1 minuto** sem eventos. Mande
  `working: false` quando terminar.

Exemplo de uma sessão inteira:

```bash
E=http://127.0.0.1:7777/api/v1/event
S='"source":{"provider":"meu-agente","sessionId":"abc123","project":"hera"}'

curl -X POST $E -H "Content-Type: application/json" -d "{$S,\"lifecycle\":\"start\",\"say\":\"Bora!\"}"
curl -X POST $E -H "Content-Type: application/json" -d "{$S,\"state\":\"terminal\",\"working\":true}"
curl -X POST $E -H "Content-Type: application/json" -d "{$S,\"state\":\"happy\",\"working\":false,\"say\":\"Build concluído!\"}"
curl -X POST $E -H "Content-Type: application/json" -d "{$S,\"lifecycle\":\"end\"}"
```

## Estados

| `state` | Pra quê |
|---|---|
| `idle` | Parada |
| `listening` | Recebeu um pedido |
| `thinking` | Pensando |
| `reading` · `searching` · `typing` · `terminal` · `web` | Lendo, buscando, editando, rodando comando, na web |
| `delegating` | Delegou pra subagentes |
| `error` | Algo falhou |
| `attention` | Precisa do usuário (ex.: permissão) |
| `happy` | Terminou / comemorando |
| `sad` | Triste |
| `sleeping` | Dormindo |

## Boas práticas pra quem integra

- **Timeout curto e falha silenciosa.** O app pode estar fechado, e a sua ferramenta
  deve seguir normalmente.
- **Não mande em loop apertado.** Um evento por mudança de estado basta.
- **Mande `working: false` e `lifecycle: "end"`** quando a sessão acabar.

## Segurança

O servidor só aceita conexões de `127.0.0.1`, recusa requisições com header `Origin`
(páginas web) e `Host` diferente de `127.0.0.1`/`localhost` (DNS rebinding). Os eventos
só mudam o que a Tera mostra: não executam nada. Detalhes em [SECURITY.md](https://github.com/kyotodevIndie/teracota/blob/main/SECURITY.md).

## Outras rotas

| Rota | Uso |
|---|---|
| `GET /health` | Responde `ok` se o app estiver aberto |
| `POST /mcp` | Servidor MCP (Streamable HTTP, sem estado) com as ferramentas `say` e `emote` (as falas opcionais do Claude Code) |
| `POST /hook` | Eventos nativos do Claude Code (usada pelo plugin) |
| `POST /usage/claude-code` | JSON da statusline do Claude Code (só `rate_limits` é lido): limites do plano no chip da interface. Usada pelo script que a Tera instala quando o usuário liga os limites nos Ajustes |

## Versões

`/api/v1/*` só muda de forma compatível: campos novos são opcionais. Mudanças que
quebram vão pra `/api/v2`. `/event` continua existindo como alias do v1.
