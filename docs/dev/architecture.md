---
description: Camadas, contratos e decisões técnicas do Teracota.
---

# Arquitetura

Visão técnica do Teracota pra quem vai contribuir. Pra instalar e usar, veja o
[guia do usuário](/guide/installation). Sobre agentes e adapters: [Integrações](./integrations). Sobre a
API local: [API local](./api).

## Stack

| Camada | Tecnologia |
|---|---|
| App | Electron (main + preload + renderer), sem framework de UI: DOM, Canvas 2D e SVG |
| Linguagem | TypeScript estrito |
| Build | esbuild (`build.mjs`); tipos checados à parte com `tsc --noEmit` |
| Integração | Adapters por agente (Claude Code: hooks via `curl`) + API local + MCP opcional (`@modelcontextprotocol/sdk`) servido pelo app |
| Testes | Vitest (lógica pura, servidor HTTP real e o core com o Electron simulado) |
| Lint | Biome (só linter) |
| Empacotamento | electron-builder (instalador NSIS do Windows; AppImage no Linux, experimental) |
| CI | GitHub Actions: `ci.yml` (checks), `release.yml` (tag → instalador → rascunho de release) e `docs.yml` (este site) |

## Visão geral

```
 Claude Code ─ hooks (curl) ─► POST /hook ──────┐
 (outros agentes: adapters futuros)             │  adapter → AgentSignal
 Qualquer ferramenta ─► POST /api/v1/event ─────┤  (source opcional)
 MCP opcional (say/emote) ─► POST /mcp ─────────┤
                                                ▼
┌──────────── Processo principal (Electron main) ────────────┐
│ server.ts        HTTP local, só 127.0.0.1                  │
│ integrations/    adapters: nativo → AgentSignal            │
│ platform/        o que varia por SO/compositor             │
│ manager.ts       Companion Core: sessões → qual Tera mostra│
│ sessions.ts      sessões por provider:sessionId            │
│ entity.ts        uma Tera = BrowserWindow + Walker + IPC   │
│ walker.ts        passeio (move a janela)                   │
│ skins.ts         skins + máscaras de clique                │
│ menu.ts, main.ts menu, bandeja, ciclo de vida              │
└──────────────┬─────────────────────────────────────────────┘
               │ IPC (shared/ipc.ts) — window.teracota no preload
               ▼
┌──────────── Renderer (uma página por Tera) ────────────────┐
│ app.ts            estados, reações, mouse, arrasto, fala   │
│ character.ts      interface Character (plugável)           │
│ sprite-character  skin de sprites em <canvas>              │
│ svg-character     desenho SVG ("clássica")                 │
│ wobble.ts         movimento procedural                     │
│ pendulum.ts       física do balanço ao arrastar            │
└────────────────────────────────────────────────────────────┘
```

**Camadas e regra de dependência:** adapters → core → renderer. Os adapters conhecem o
agente; o core só conhece `AgentSignal` e `CompanionEvent`; o renderer só conhece
`CompanionEvent`. Um teste garante que nada específico de agente escape de
`src/main/integrations/`.

## Contratos

### `CompanionEvent` (`src/shared/protocol.ts`)

O que a Tera deve mostrar: `state`, `expression`, `anim`, `say`, `duration`, `working` e
`from` (etiqueta de origem montada pelo core). Os estados e a pose de sprite de cada
um ficam em `src/renderer/states.ts`. Os estados de ferramenta expiram depois de 8s e
voltam pra `thinking`.

### `AgentSignal` (`src/main/integrations/types.ts`)

O que um adapter entrega: `source` (provider, sessão, projeto), `lifecycle`, `working`,
`mcpCall` e `event`. Detalhes em [Integrações](./integrations).

### Roteamento (`src/main/manager.ts`)

- Chave de sessão: `provider:sessionId`, então agentes diferentes nunca colidem.
- **Modo uma só:** uma Tera recebe tudo. `working` = alguma sessão trabalhando. Com mais
  de uma sessão, as falas ganham `from`.
- **Modo uma por sessão:** até 5 Teras. A primeira é a "de casa" e nunca vai embora. Com
  `lifecycle: 'end'`, a Tera acena e sai.
- **Etiqueta:** o projeto, ou `Agente · projeto` quando há agentes diferentes abertos.
  Atualiza sozinha quando entra ou sai um agente.
- **Sessão fantasma:** removida depois de 45 min sem eventos. O "trabalhando" expira em
  10 min, ou em 1 min se o agente não declarar `completion`.
- **MCP → sessão certa:** um sinal com `mcpCall` marca a sessão, e a chamada MCP que
  chega em até 5s vai pra Tera dela.

### IPC (`src/shared/ipc.ts`)

`window.teracota`: do main pro renderer vão `onEvent`, `onWalk`, `onCursor` (a cada
33ms), `onMode`, `onIdentity`, `onLeave` e `getSkin`; do renderer pro main vão
`setIgnoreMouse`, `openContextMenu`, `moveBy`, `dragEnd`, `setWalkAllowed` e `notifyClick`.

### `Character` (`src/renderer/character.ts`)

`show(look)`, `setProp`, `setMotion('walk'|'drag'|null, dir)`, `setTalking`, `setSwing`,
`lookAt` e `hitTest`. O `SpriteCharacter` usa **poses**; o `SvgCharacter` usa
**expressão + animação CSS**. Um tipo novo (Live2D, peças recortadas) só precisa
implementar essa interface.

### Skins

`assets/skins/<id>/skin.json` ou `%APPDATA%/Teracota/skins/<id>/`. Formato no
[Criando skins](./skins).

## Decisões e restrições

1. **O usuário final não precisa de Node.** Integrações usam HTTP local; hooks usam `curl`.
2. **Nunca atrapalhar o agente.** As rotas de adapter sempre respondem 204. Os hooks têm
   timeout curto e `|| exit 0`. Com o app fechado, nada quebra.
3. **Só local.** O servidor escuta em `127.0.0.1` e recusa `Origin` e `Host` estranho. Os
   eventos só mudam o visual.
4. **Performance importa.** Parada: ~5% de um núcleo e ~400 MB. Os frames são
   pré-redimensionados e a taxa de quadros se adapta (60 em movimento, 24 parada, 15
   dormindo).
5. **Clique atravessando a janela é frágil no Windows.** O hover vem da posição do
   cursor lida pelo main e testada contra a máscara de alfa do frame; o estado é
   reafirmado a cada 1s.
6. **Uma `BrowserWindow` por Tera.** O passeio move a janela.
7. **Assets fora do `.asar`** (`extraResources`), porque são lidos via `file://` e `nativeImage`.
8. **Dev separado do instalado:** sem empacotar, o app se chama "Teracota Dev" e tem
   config e trava próprias. `TERACOTA_PORT` muda a porta.

## Limitações conhecidas

- Só 4 frames por animação; o ícone da atividade não se ajusta por pose.
- As falas pelo MCP são opcionais: quem liga e fecha o app vê erro de conexão do MCP no Claude Code.
- Sem testes automatizados das janelas (Electron real), do renderer e de ponta a ponta.
- macOS e Linux sem build nem teste; instalador do Windows sem assinatura e sem
  atualização automática.
