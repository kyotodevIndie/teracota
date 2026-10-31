---
layout: home
title: Teracota
titleTemplate: A desktop cat girl for your coding agent
description: Tera is a desktop cat girl that reacts to Claude Code in real time. Open source, runs on your machine, Windows beta.

hero:
  name: Teracota
  text: Your coding agent comes to life on your desktop
  tagline: Tera sits at her laptop while Claude edits, gets confused when something breaks, waves when it needs you, and celebrates when it's done.
  image:
    src: /tera/happy-2.png
    alt: Tera, a chibi cat girl with terracotta hair, jumping with joy
  actions:
    - theme: brand
      text: Download for Windows
      link: https://github.com/kyotodevIndie/teracota/releases/latest
    - theme: alt
      text: How to install
      link: /en/guide/installation
    - theme: alt
      text: GitHub
      link: https://github.com/kyotodevIndie/teracota

features:
  - icon: 🐾
    title: Reacts to Claude Code
    details: Reading, editing, running commands, errors, permission requests, task done. Every moment gets a reaction, so you don't have to keep an eye on the terminal.
  - icon: 👯
    title: Multiple sessions
    details: One Tera for all sessions (the speech bubble says which project it's about) or one Tera per session, each with its own color and name tag.
  - icon: 🖱️
    title: A real desktop pet
    details: She wanders around, naps, reacts to clicks, swings when you drag her and enjoys head pats. Or she just stays quietly in a corner.
  - icon: 🔌
    title: One click to connect
    details: She finds Claude Code and installs the plugin with a single click. No Node, no manual setup.
  - icon: 🧩
    title: Open local API
    details: Any tool can make Tera react with a POST to localhost. Official integrations with other agents are on the roadmap.
  - icon: 🔒
    title: Local and open source
    details: Runs on your machine, listens only on 127.0.0.1 and sends nothing to the internet. MIT code, CC BY 4.0 art.
---

<div class="tera-section">

## See her react

These are Tera's real reactions, drawn with the app's artwork. Click a situation:

<TeraDemo />

## Install in 3 steps

1. Download `Teracota Setup x.y.z.exe` from the [releases page](https://github.com/kyotodevIndie/teracota/releases/latest) and run it. The installer isn't code-signed yet, so Windows shows a warning: click **More info → Run anyway**.
2. **Click Tera** to open her window and connect to Claude Code (or use the menu → **Conectar ao Claude Code**).
3. Start a Claude Code session. That's it.

The full walkthrough is in the [installation guide](/en/guide/installation).

## Project status

Teracota is a **Windows beta**. Today:

- ✅ **Claude Code** integration (plugin) and a [local API](/en/dev/api) for other tools
- ✅ Tera skin with 13 animations, plus the classic drawing as a fallback
- 🗺️ **Planned:** focus sessions (Pomodoro), smoother animations, macOS and Linux, OpenCode and Codex adapters. See the [roadmap](https://github.com/kyotodevIndie/teracota/blob/main/ROADMAP.md).

::: info The app speaks Portuguese
The app's menu and Tera's lines are in Brazilian Portuguese for now. English is on the roadmap.
:::

## Contribute

The project is open source and welcomes code, skins, translations and ideas.
Start with [Contributing](/en/dev/contributing).

<p style="font-size: 13px; color: var(--vp-c-text-3); margin-top: 32px">Independent project, not affiliated with Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.</p>

</div>
