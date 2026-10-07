---
description: Perguntas frequentes e solução de problemas do Teracota.
---

# FAQ e solução de problemas

## A Tera não reage ao Claude Code

Confira nesta ordem:

1. **O Teracota está aberto?** O ícone dela deve estar na bandeja.
2. **O plugin está instalado?** Rode `claude plugin list`. Deve aparecer `teracota@teracota`.
   Se não aparecer, veja [Conectar ao Claude Code](./installation#_3-conectar-ao-claude-code).
3. **A sessão foi aberta antes de instalar o plugin?** Rode `/reload-plugins` nela, ou
   reinicie a sessão.
4. **O app está ouvindo?** Este comando deve fazer a Tera pular e dizer "oi":
   ```bash
   curl -X POST http://127.0.0.1:7777/api/v1/event -H "Content-Type: application/json" -d '{"state":"happy","say":"oi"}'
   ```
   Se não funcionar, outro programa pode estar usando a porta `7777`.

## Os eventos chegam em dobro

Isso acontece quando há duas integrações ativas pro mesmo Claude Code: por exemplo, o
plugin **e** hooks configurados à mão em `.claude/settings.local.json`. Deixe só uma.

## O Claude Code mostra erro de conexão do MCP "teracota"

As **falas pelo MCP** estão ligadas e o Teracota está fechado. Abra o app (e rode `/mcp`
pra reconectar) ou desligue as falas no menu da Tera
([detalhes](./claude-code#falas-pelo-mcp-opcional)). O plugin sozinho nunca gera esse erro.

## A Tera sumiu

Clique com o botão direito no ícone dela na bandeja → **Voltar pro canto**. Se ela
estiver escondida, use **Mostrar Tera**.

## Não consigo clicar nela

Só o desenho responde ao mouse: o fundo transparente deixa o clique passar de propósito.
Se nem o desenho responder, [abra um bug](https://github.com/kyotodevIndie/teracota/issues/new/choose)
contando o que você fazia antes (arrastando, ela andando, trocando de monitor...) e
quais monitores e escalas você usa.

## O Windows diz que protegeu o computador

É o SmartScreen, porque o instalador ainda não tem assinatura digital. Clique em
**Mais informações → Executar assim mesmo**. Mais detalhes em
[Instalação](./installation#_1-baixar-e-instalar).

## Ela pesa no computador?

Parada, a Tera usa cerca de **5% de um núcleo** de CPU e uns **400 MB** de memória (é um
app Electron). Ela reduz a taxa de quadros quando está parada ou dormindo. No modo "uma
por sessão", cada Tera extra é mais uma janela.

## Ela deixa o Claude Code mais lento?

Quase nada. Cada evento é um `curl` local que leva milissegundos. Com o app fechado, ele
falha na hora. Se o app travar, o `curl` desiste em até 2 segundos.

## Privacidade e segurança

- Tudo roda **na sua máquina**. O app escuta só em `127.0.0.1` e **nada vai pra internet**.
- O JSON que o Claude Code entrega pros hooks traz detalhes do evento, inclusive o que
  a ferramenta recebeu. O Teracota lê só o nome do evento, o id da sessão, a pasta do
  projeto e o nome da ferramenta, e **não guarda nem envia nada**.
- O servidor local recusa requisições de páginas web (header `Origin`) e de outros
  hosts (DNS rebinding). Os eventos só mudam o que a Tera mostra: não executam nada.
- O app só guarda as suas preferências (`%APPDATA%\Teracota\config.json`).
- Ao abrir, ele roda comandos **só de leitura** da CLI do Claude (`claude plugin list`,
  `claude mcp get teracota`) pra saber se a integração está ativa. Ele só instala ou remove
  algo quando você pede (pelo clique na oferta ou pelo menu).
- Achou uma falha? Veja a [política de segurança](https://github.com/kyotodevIndie/teracota/blob/main/SECURITY.md).

## Funciona no macOS ou no Linux?

O Linux é **experimental** (veja [como rodar](./installation#linux-experimental)); o macOS
ainda não. Ambos estão no
[roadmap](https://github.com/kyotodevIndie/teracota/blob/main/ROADMAP.md), e ajuda é bem-vinda.

## Funciona com outros agentes (Codex, OpenCode...)?

A integração oficial hoje é só com o **Claude Code**. Adapters pro OpenCode e o Codex
estão **planejados**, mas ainda não existem. Enquanto isso, qualquer ferramenta pode fazer
a Tera reagir pela [API local](/dev/api).

## É um produto da Anthropic?

Não. O Teracota é um projeto independente e open source, sem afiliação com a Anthropic.

## Como fecho de vez?

Menu → **Sair do Teracota**. Pra ela não abrir com o Windows, desmarque **Abrir com o
Windows** no menu.
