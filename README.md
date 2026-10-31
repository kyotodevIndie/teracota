# Teracota

[![CI](https://github.com/kyotodevIndie/teracota/actions/workflows/ci.yml/badge.svg)](https://github.com/kyotodevIndie/teracota/actions/workflows/ci.yml)

<img src="docs/public/tera/happy-2.png" alt="Tera, uma gatinha chibi de cabelo terracota, pulando de alegria" width="160" align="right" />

**Tera** é uma gatinha que mora no seu desktop e acompanha o seu agente de código. Hoje
ela reage ao [Claude Code](https://claude.com/claude-code): senta no notebook quando o
Claude está editando, fica confusa quando dá erro, acena quando ele precisa de você,
comemora quando termina e passeia pela tela quando está tudo calmo.

*Tera is a desktop cat girl that reacts to your coding agent (Claude Code today).
English docs: [docs/en](docs/en/index.md).*

> **Beta, só Windows por enquanto.** Projeto independente, não é afiliado à Anthropic.

## Instalar

1. Baixe o `Teracota Setup x.y.z.exe` em [Releases](https://github.com/kyotodevIndie/teracota/releases/latest) e rode.
   O instalador ainda não tem assinatura digital: no aviso do Windows, clique em
   **Mais informações → Executar assim mesmo**.
2. **Clique na Tera**: abre a janela dela. Lá, **Conectar ao Claude Code**.
3. Abra uma sessão do Claude Code.

Passo a passo, comandos manuais e desinstalação: [guia de instalação](docs/guide/installation.md).

## Documentação

| | |
|---|---|
| **Usuários** | [Instalação](docs/guide/installation.md) · [Usando a Tera](docs/guide/usage.md) · [Claude Code](docs/guide/claude-code.md) · [FAQ e problemas](docs/guide/faq.md) |
| **Desenvolvimento** | [Contribuindo](CONTRIBUTING.md) · [Arquitetura](docs/dev/architecture.md) · [Integrações com agentes](docs/dev/integrations.md) · [API local](docs/dev/api.md) · [Criando skins](docs/dev/skins.md) |
| **Projeto** | [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md) · [Segurança](SECURITY.md) · [Código de Conduta](CODE_OF_CONDUCT.md) |

A pasta `docs/` também é o site do projeto (VitePress): `pnpm docs:dev`.

## Desenvolvimento

```bash
corepack enable     # ativa o pnpm na versão do packageManager
pnpm install
pnpm start          # builda e abre ("Teracota Dev")
pnpm check          # typecheck + lint + testes
```

Detalhes no [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

Código: [MIT](LICENSE). Arte da Tera (`assets/` e as imagens do site): [CC BY 4.0](LICENSE-ART.md),
use à vontade com crédito.
