# Contribuindo com o Teracota

Que bom que você quer ajudar a Tera! 🐾 Toda contribuição conta: reportar um bug,
sugerir uma ideia, melhorar o código, desenhar uma skin ou traduzir falas.

- [Formas de contribuir](#formas-de-contribuir)
- [Rodando o projeto](#rodando-o-projeto)
- [Conectando o seu Claude Code ao app em desenvolvimento](#conectando-o-seu-claude-code-ao-app-em-desenvolvimento)
- [Onde fica cada coisa](#onde-fica-cada-coisa)
- [Integrando um agente](#integrando-um-agente)
- [Adicionando uma plataforma](#adicionando-uma-plataforma)
- [Estilo de código](#estilo-de-código)
- [Testes](#testes)
- [Commits e pull requests](#commits-e-pull-requests)
- [Skins](#skins)
- [Lançando uma versão](#lançando-uma-versão-mantenedores)

## Formas de contribuir

- **Achou um bug?** Abra uma issue com o formulário de bug. Diga o que você estava
  fazendo logo antes e quais monitores/escala usa — muita coisa depende disso.
- **Tem uma ideia?** Dê uma olhada no [ROADMAP](ROADMAP.md) e abra uma sugestão.
- **Quer programar?** Procure issues com **`good first issue`** ou algum item do
  roadmap. Pra algo grande, abra uma issue antes pra combinar a abordagem.
- **Desenha?** Skins novas são muito bem-vindas — veja [Skins](#skins).
- **Usa outro agente de código?** Veja [Integrando um agente](#integrando-um-agente).

Participando, você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md).

## Rodando o projeto

Precisa de **Node.js 22+**. **Windows** é a plataforma suportada; o **Linux** é
experimental (testado no Arch com Hyprland) e o macOS está no roadmap — ajuda bem-vinda.

```bash
git clone https://github.com/kyotodevIndie/teracota.git
cd teracota
npm install
npm start
```

A Tera aparece no canto da tela e um ícone surge na bandeja do sistema.

Rodando pelo código, o app se chama **"Teracota Dev"**, com configuração própria, e
convive com o Teracota instalado. Só a porta é a mesma: se o instalado estiver aberto,
use outra, como `TERACOTA_PORT=7788 npm start`.

| Comando | O que faz |
|---|---|
| `npm start` | Builda e abre o app |
| `npm run watch` | Rebuild automático; depois é só botão direito na Tera → **Recarregar** |
| `npm run check` | Typecheck + lint + testes — **rode antes de abrir um PR** |
| `npm test` | Só os testes (`npm run test:watch` pra deixar rodando) |
| `npm run demo` | Com o app aberto, passa por todos os estados da Tera |
| `npm run pack` | Gera o app desempacotado em `release/win-unpacked` |
| `npm run dist` | Gera o instalador em `release/` |

Pra testar reações sem nenhum agente, mande eventos direto pro app pela
[API local](docs/dev/api.md):

```bash
curl -X POST http://127.0.0.1:7777/api/v1/event -H "Content-Type: application/json" \
  -d '{"state":"happy","say":"Oi!"}'
```

## Conectando o seu Claude Code ao app em desenvolvimento

O app recebe eventos do Claude Code por hooks. Escolha **um** dos caminhos:

- **Plugin** (o mesmo dos usuários): `claude plugin marketplace add kyotodevIndie/teracota`
  e `claude plugin install teracota@teracota`. Pra testar mudanças no próprio plugin, aponte
  o marketplace pra sua cópia local: `claude plugin marketplace add ./`.
- **Só nesta pasta, sem plugin:** copie `.claude/settings.example.json` para
  `.claude/settings.local.json` (é pessoal e não vai pro git).

Não use os dois na mesma pasta, ou os eventos chegam em dobro. Assim, o próprio Claude
que te ajuda a programar faz a Tera reagir. 😄

As **falas pelo MCP** (`say`/`emote`) são opcionais e ficam fora do plugin. Ligue no menu
da Tera → **Deixar o Claude Code falar pela Tera**, ou à mão:
`claude mcp add --scope local --transport http teracota http://127.0.0.1:7777/mcp`.

## Onde fica cada coisa

A arquitetura completa (camadas, contratos, decisões) está em
[docs/dev/architecture.md](docs/dev/architecture.md). Atalhos:

| Quero mudar... | Arquivo |
|---|---|
| Como cada ferramenta do Claude vira uma reação | `src/main/integrations/claude-code/adapter.ts` |
| Suportar outro SO, distro ou compositor | `src/main/platform/` (veja [Adicionando uma plataforma](#adicionando-uma-plataforma)) |
| Integrar outro agente | `src/main/integrations/` (veja [Integrando um agente](#integrando-um-agente)) |
| API local (`/api/v1/event`) | `src/shared/protocol.ts` (validação) e `src/main/server.ts` |
| Estados (pose, expressão, ícone, duração) | `src/renderer/states.ts` |
| Falas da Tera | adapters em `src/main/integrations/` (eventos) e `src/renderer/app.ts` (cliques, carinho) |
| Movimento contínuo (respirar, quicar) | `src/renderer/wobble.ts` |
| Balanço ao ser arrastada | `src/renderer/pendulum.ts` |
| Passeio pela tela | `src/main/walker.ts` |
| Sessões, uma Tera por sessão, roteamento (Companion Core) | `src/main/manager.ts`, `src/main/sessions.ts` |
| Menu e bandeja | `src/main/menu.ts`, `src/main/main.ts` |
| Ferramentas MCP (`say`, `emote`) | `src/main/mcp.ts` |
| Nome, cores, repositório | `src/shared/brand.ts` |
| Plugin do Claude Code | `plugin/` e `.claude-plugin/marketplace.json` |

O app tem três partes que conversam por IPC: **main** (Node/Electron: janelas,
servidor HTTP, sessões), **preload** (a ponte) e **renderer** (a página da Tera).
O contrato entre elas está em `src/shared/ipc.ts`.

## Integrando um agente

O Teracota é pensado pra funcionar com vários agentes de código por meio de
**adapters**. Antes de começar, leia [docs/dev/integrations.md](docs/dev/integrations.md): ele tem
a arquitetura, o checklist do que o agente precisa oferecer e o passo a passo.

As regras que o CI cobra:

- **Nada específico de um agente fora de `src/main/integrations/<agente>/`.** O core e o
  renderer só conhecem o protocolo normalizado. Um teste
  (`src/main/integrations/integrations.test.ts`) falha se isso for quebrado.
- **Nunca atrapalhar o agente:** o `toSignal` não lança erro, e o lado do agente
  (plugin/hook) tem timeout curto e falha em silêncio com o app fechado.
- **Só interfaces oficiais e estáveis**, e nada de anunciar suporte antes de validar o
  fluxo real.

Sem adapter oficial, dá pra integrar qualquer ferramenta pela [API local](docs/dev/api.md)
(`/api/v1/event` com `source`), inclusive como protótipo antes de propor um adapter.

## Adicionando uma plataforma

Tudo que muda de um sistema pra outro fica em `src/main/platform/`, atrás da interface
`Platform` (`types.ts`): um arquivo por sistema (`windows.ts`, `linux.ts`, `darwin.ts`).

- **Outro SO:** crie `<nome>.ts`, implemente `Platform` e registre em `index.ts`.
- **Outra distro ou compositor (KDE, sway, GNOME...):** trate dentro do `linux.ts`,
  lendo o ambiente. Só vale um arquivo novo quando o comportamento for realmente outro.
- **Algo novo que varia?** Acrescente o método na interface e implemente em cada arquivo.
  Prefira funções puras que recebem `env`/`argv`, pra testar sem Electron.

Um teste (`platform/platform.test.ts`) falha se `process.platform`, `win32`/`darwin` ou
`XDG_*` aparecerem fora de `platform/`, e o de integrações impede que `platform/`
cite agentes. Empacotamento fica no `package.json` (`build.<so>`).

## Estilo de código

- **TypeScript estrito.** Nada de `any`; prefira tipos do `src/shared/`.
- **Siga o estilo do arquivo ao redor.** Não usamos formatador automático (ele
  desfaria o alinhamento das tabelas de estados e expressões); o `.editorconfig`
  cuida do básico e o **Biome** (`npm run lint`) aponta problemas.
- **Nomes no código em inglês, comentários em português.** Comente o *porquê*,
  não o *o quê*.
- **Nada de dependência nova sem motivo forte** — o app fica aberto o dia todo;
  leve importa.
- Mudou algo que roda a cada quadro (renderer)? Olhe o consumo de CPU antes e depois.

## Testes

Os testes usam **Vitest** e ficam ao lado do código (`arquivo.test.ts`). Cobrimos a
lógica que não depende do Electron: validação de eventos, tradução de hooks,
sessões, física do pêndulo, leitura de skins.

Corrigiu um bug nessa lógica? Adicione um teste que falharia antes da correção.
Mexeu em algo visual? Descreva no PR como testou — um gif vale ouro.

## Commits e pull requests

1. Faça um fork e crie uma branch a partir da `main` (`fix/clique-travado`,
   `feat/falas-em-ingles`...).
2. Commits pequenos, com mensagem em português no imperativo e um corpo explicando
   o porquê quando não for óbvio:
   ```
   Corrige Tera às vezes impossível de clicar

   A detecção dependia só dos eventos repassados pelo setIgnoreMouseEvents...
   ```
3. Rode `npm run check`.
4. Abra o PR preenchendo o template. O CI roda typecheck, lint, testes e build.
5. Um mantenedor revisa; pode ser que peça ajustes — é normal e faz parte. 💛

## Skins

O formato, as poses, os requisitos dos frames e como importar um pacote estão em
**[Criando skins](docs/dev/skins.md)**. Pra testar, coloque a pasta em
`%APPDATA%/Teracota/skins/<id>/` e escolha no menu **Skin**.

**Licença:** a arte do projeto é [CC BY 4.0](LICENSE-ART.md), e skins enviadas ao repositório
entram na mesma licença, com o seu crédito. Só envie arte que você fez ou tem direito de
distribuir — personagens de terceiros (anime, jogos, marcas) não entram no repositório.

## Lançando uma versão (mantenedores)

1. Atualize a versão em `package.json` **e** em `plugin/.claude-plugin/plugin.json`.
2. Mova os itens de "Não lançado" do [CHANGELOG](CHANGELOG.md) pra nova versão.
3. Commit, depois `git tag vX.Y.Z && git push --tags`.
4. O workflow **Release** gera o instalador e cria um **rascunho** de release com ele
   anexado. Revise as notas e publique.
