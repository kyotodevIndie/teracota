# Changelog

As mudanças de cada versão. Formato baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e o projeto segue [versionamento semântico](https://semver.org/lang/pt-BR/). Enquanto a
versão for `0.x`, o projeto é beta e a API pode mudar entre versões menores.

## [Não lançado]

### Adicionado
- **Linux (experimental):** a Tera roda no Arch com Hyprland. No Wayland o app se reabre
  via XWayland pra conseguir ficar no canto e passear. Alvo AppImage (`npm run dist:linux`)

### Alterado
- O que depende de sistema operacional ficou isolado em `src/main/platform/`, com um
  arquivo por sistema, pra facilitar suportar outras distros e SOs
- O item "Abrir ao iniciar o sistema" não aparece onde não é suportado (Linux)

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
