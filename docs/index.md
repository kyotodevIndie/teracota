---
layout: home
title: Teracota
titleTemplate: Uma gatinha de desktop pro seu agente de código
description: Tera é uma gatinha de desktop que reage ao Claude Code em tempo real. Open source, roda na sua máquina, beta pra Windows.

hero:
  name: Teracota
  text: Seu agente de código ganha vida no desktop
  tagline: A Tera senta no notebook quando o Claude edita, fica confusa quando dá erro, acena quando ele precisa de você e comemora quando termina.
  image:
    src: /tera/happy-2.png
    alt: Tera, uma gatinha chibi de cabelo terracota, pulando de alegria
  actions:
    - theme: brand
      text: Baixar pra Windows
      link: https://github.com/kyotodevIndie/teracota/releases/latest
    - theme: alt
      text: Como instalar
      link: /guide/installation
    - theme: alt
      text: GitHub
      link: https://github.com/kyotodevIndie/teracota

features:
  - icon: 🐾
    title: Reage ao Claude Code
    details: Lendo, editando, rodando comando, erro, pedido de permissão, fim de tarefa. Cada momento tem uma reação, sem você precisar olhar o terminal.
  - icon: 👯
    title: Várias sessões
    details: Uma Tera pra todas as sessões (o balão diz de qual projeto veio o aviso) ou uma Tera por sessão, cada uma com cor e plaquinha.
  - icon: 🖱️
    title: Pet de verdade
    details: Passeia pela tela, cochila, reage ao clique, balança quando você arrasta e gosta de carinho. Ou fica quietinha num canto.
  - icon: 🔌
    title: Um clique pra conectar
    details: Ela acha o Claude Code e instala o plugin com um clique. Sem Node, sem configurar nada à mão.
  - icon: 🧩
    title: API local aberta
    details: Qualquer ferramenta pode fazer a Tera reagir com um POST em localhost. Integrações oficiais com outros agentes estão no roadmap.
  - icon: 🔒
    title: Local e open source
    details: Roda na sua máquina, escuta só em 127.0.0.1 e não manda nada pra internet. Código MIT, arte CC BY 4.0.
---

<div class="tera-section">

## Veja ela reagindo

Estas são as reações reais da Tera, com a arte do app. Clique nas situações:

<TeraDemo />

## Instalação em 3 passos

1. Baixe o `Teracota Setup x.y.z.exe` na [página de releases](https://github.com/kyotodevIndie/teracota/releases/latest) e rode. Como o instalador ainda não tem assinatura digital, o Windows mostra um aviso: clique em **Mais informações → Executar assim mesmo**.
2. **Clique na Tera** pra abrir a janela dela e conecte ao Claude Code (ou use o menu → **Conectar ao Claude Code**).
3. Abra uma sessão do Claude Code. Pronto.

O passo a passo completo está no [guia de instalação](/guide/installation).

## Status do projeto

O Teracota está em **beta pra Windows**. Hoje:

- ✅ Integração com o **Claude Code** (plugin) e [API local](/dev/api) pra outras ferramentas
- ✅ Skin da Tera com 13 animações e o desenho clássico como reserva
- 🗺️ **Planejado:** sessões de foco (Pomodoro), animações com mais frames, macOS e Linux, adapters pro OpenCode e o Codex. Veja o [roadmap](https://github.com/kyotodevIndie/teracota/blob/main/ROADMAP.md).

## Contribua

O projeto é open source e aceita código, skins, traduções e ideias.
Comece por [Contribuindo](/dev/contributing).

<p style="font-size: 13px; color: var(--vp-c-text-3); margin-top: 32px">Projeto independente, sem afiliação com a Anthropic. "Claude" e "Claude Code" são marcas da Anthropic.</p>

</div>
