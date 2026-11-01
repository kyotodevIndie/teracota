# Changelog

As mudanças de cada versão. Formato baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e o projeto segue [versionamento semântico](https://semver.org/lang/pt-BR/). Enquanto a
versão for `0.x`, o projeto é beta e a API pode mudar entre versões menores.

## [Não lançado]

### Mudou
- **Interface nova, presa na Tera**: cartões de vidro empilhados como notificações, abrindo
  em cima dela (sem espaço, embaixo) e acompanhando quando ela é arrastada; a Tera fica
  parada enquanto a interface está aberta. Abas embaixo: Agora, Terminal, Sessões e Ajustes.
  Clicar na Tera de novo fecha
- **Clicar na Tera abre a interface dela** (uma janela só; fechar esconde e a Tera continua
  no desktop). Conectar ao Claude Code virou um botão explícito na interface; a oferta da
  primeira execução só convida a abrir a janela
- **Rig 2D é o renderer padrão**, com poses, expressões, piscada, olhar pro cursor, boca
  falando e passos; a arte das camadas ainda é provisória. Os sprites continuam como fallback
- Passeio e desenho no mesmo quadro da tela: some o tremido ao andar em telas de 120/144 Hz,
  e trocar de pose não dá mais "pulo"
- Repositório virou monorepo pnpm (`apps/desktop`, `packages/character`, `packages/agent-bridge`)

### Adicionado
- **Skin Studio e `tera-skin`** (pra quem cria skins): editor visual de rigs no navegador
  (montar camadas, pivôs, poses, expressões e movimentos, testar cada estado do app) e um
  comando pra criar, validar e renderizar a skin com o motor da Tera, gerando uma folha de
  conferência em PNG. Feito pra funcionar junto com agentes de código: o que o agente muda
  no `rig.json` aparece no editor na hora (`docs/dev/skin-studio.md`)
- **Sessões ao vivo**: todas as sessões do Claude Code do PC (terminal, IDE, aba Terminal da
  Tera) aparecem com o que estão fazendo (lendo, editando, rodando comando…) e as
  encerradas há pouco
- **Pedidos das IAs**: quando uma IA pede permissão ou faz uma pergunta (com as
  alternativas), o pedido vai pro topo da pilha; com a interface fechada, aparece sozinho
  perto da Tera, sem roubar o foco. A resposta continua no terminal da sessão
- **Limites de uso por IA**: um chip por IA no topo (a % da janela mais apertada) e, com o
  mouse em cima, o balão com cada limite e quando reinicia. Para o Claude, liga nos Ajustes:
  a Tera passa a ler os limites do plano pela statusline do Claude Code (a sua continua
  aparecendo; desligar devolve a anterior)
- **Temas** nos Ajustes (Vidro, Aurora, Claro, Contraste) e a opacidade do vidro
- **Terminal na janela da Tera**: o seu shell e o seu `claude` (com o login que você já
  usa, sem API paga); a Tera reage a essa sessão como a qualquer outra
- "Reduzir movimento" no menu (e respeita o `prefers-reduced-motion` do sistema)
- Linux: o app se reabre em XWayland quando a sessão é Wayland (lá a janela não se posiciona)
- A Tera volta pra tela se for solta fora da área útil ou se um monitor for desligado; o
  clique na bandeja também a traz de volta

### Removido
- Mini Companion (modo compacto experimental): quem estava nele volta pra Tera completa

### Segurança
- Electron 44.9.3; MCP SDK 1.32.1 e correções em dependências transitivas dele (body-parser,
  fast-uri, hono, @hono/node-server, ip-address, qs): `pnpm audit --prod` sem achados

## [0.1.0] — 2026-10-01 (beta)

Primeira versão pública: beta pra Windows.

### A Tera
- Personagem de desktop que reage ao **Claude Code** em tempo real: atenta ao receber um
  pedido; trabalhando ao ler, buscar, editar, rodar comando, navegar ou delegar; confusa
  em erros; acenando quando o Claude precisa de permissão; comemorando ao terminar
- **Uma Tera só** (acompanha todas as sessões e diz de qual projeto veio cada aviso) ou
  **uma por sessão** (até 5, cada uma com cor e plaquinha do projeto)
- Passeia pela tela ou fica parada; cochila quando ociosa; reage a clique, arrasto (com
  balanço físico) e carinho
- Skin de sprites (13 animações) com movimento procedural, e o desenho clássico em SVG
  como reserva; suporte a skins de terceiros (`skin.json`)
- Bandeja do sistema, apresentação na primeira execução, abrir com o Windows

### Integração
- **Plugin do Claude Code** (`teracota@teracota`): hooks via `curl`, sem Node. Com o app
  fechado, falha em silêncio
- **Um clique pra conectar:** a Tera detecta o Claude Code e instala o plugin quando você
  clica nela (ou pelo menu); "Conectar sessões já abertas" copia `/reload-plugins`
- **Falas pelo MCP** (opcional, desligadas por padrão): o Claude pode fazer a Tera falar
  e reagir (`say`, `emote`)
- **API local v1** (`POST /api/v1/event`): qualquer ferramenta faz a Tera reagir; com
  `source`, ganha sessões e Teras próprias
- Arquitetura de adapters por agente, preparada pra integrações futuras

### Segurança e privacidade
- Servidor local só em `127.0.0.1`, recusando páginas web (`Origin`) e DNS rebinding
- Nada é guardado nem enviado pra fora; o app só salva as preferências

### Distribuição
- Instalador do Windows (NSIS, por usuário, sem assinatura digital)
- Site e documentação em português e inglês
