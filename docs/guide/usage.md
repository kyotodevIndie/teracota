---
description: O que a Tera faz, como interagir com ela, o menu e os modos.
---

# Usando a Tera

## O que ela mostra

| Situação | O que a Tera faz |
|---|---|
| Você mandou um pedido | Levanta a orelha, atenta ❗ |
| O agente está lendo, buscando, editando ou rodando comando | Senta no notebook e trabalha, com o ícone da atividade (📖 🔍 ⌨️ 💻 🌐) |
| Pensando entre um passo e outro | Pensativa 💭 |
| Delegou pra subagentes | Conversando 👥 |
| Algo falhou | Fica confusa 💢 ("Ops...") |
| O agente precisa da sua permissão | Acena chamando você 🙋 |
| Terminou | Comemora ✨ |
| Sem nada pra fazer | Passeia pela tela (se o passeio estiver ligado) |
| Muito tempo parada | Cochila 💤 |

As atividades duram alguns segundos e voltam pro estado de base. Ela não fica presa
"trabalhando" se o agente parar de mandar eventos.

## Interagindo

| Ação | Reação |
|---|---|
| **Clique** | Abre a janela dela (agentes e conversa). Se estiver dormindo, acorda e abre. Fechar a janela não tira a Tera do desktop. |
| **Arrastar** | Ela balança como um pêndulo, conforme a velocidade, e fica onde você soltar. |
| **Passar o mouse de um lado pro outro** em cima dela | Carinho ♥ |
| **Botão direito** nela ou no ícone da bandeja | Menu |

Só o desenho da Tera responde ao mouse. O fundo transparente deixa o clique passar
pra janela de trás.

## Menu

| Item | O que faz |
|---|---|
| **Esconder / Mostrar Tera** | Some da tela, mas continua rodando na bandeja |
| **Passear pela tela / Ficar parada** | Se ela passeia quando está ociosa |
| **Uma Tera só / Uma por sessão de agente** | Veja [Modos](#uma-tera-ou-varias) |
| **Skin** | Troca o visual (a Tera ou o desenho clássico) |
| **Voltar pro canto** | Traz de volta, se ela se perdeu num monitor |
| **Conectar ao Claude Code** | Instala o plugin ([detalhes](./claude-code)) |
| **Conectar sessões já abertas** | Copia `/reload-plugins` |
| **Deixar o Claude Code falar pela Tera** | Liga ou desliga as falas pelo MCP (opcional) |
| **Abrir com o Windows** | Inicia junto com o sistema |
| **Sair do Teracota** | Fecha o app |

## Uma Tera ou várias

- **Uma Tera só** (padrão): uma Tera acompanha todas as sessões. Com mais de uma
  sessão aberta, o balão diz de qual projeto veio cada aviso (ex.: `front` *Terminei!*).
  Ela só para de "trabalhar" quando **todas** as sessões param.
- **Uma por sessão de agente**: cada sessão ganha a sua Tera (até 5), com cor própria
  e uma plaquinha com o nome do projeto. Quando a sessão termina, ela acena e vai
  embora. A primeira Tera ("de casa") sempre fica.

Se houver agentes diferentes abertos ao mesmo tempo (ex.: Claude Code e uma ferramenta
pela [API local](/dev/api)), a etiqueta vira **Agente · projeto**.

## Onde ficam suas preferências

Posição, modos e skin ficam em `%APPDATA%\Teracota\config.json`, na sua máquina.
Veja também [Privacidade](./faq#privacidade-e-seguranca).
