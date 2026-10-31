---
description: What Tera does, how to interact with her, the menu and the modes.
---

# Using Tera

## What she shows

| Situation | What Tera does |
|---|---|
| You sent a request | Perks up, paying attention ❗ |
| The agent is reading, searching, editing or running a command | Sits at her laptop and works, with an activity icon (📖 🔍 ⌨️ 💻 🌐) |
| Thinking between steps | Thoughtful 💭 |
| Delegated to subagents | Chatting 👥 |
| Something failed | Confused 💢 |
| The agent needs your permission | Waves at you 🙋 |
| Done | Celebrates ✨ |
| Nothing to do | Wanders around the screen (if wandering is on) |
| Idle for a while | Naps 💤 |

Activities last a few seconds and fall back to the base state. She never gets stuck
"working" if the agent stops sending events.

## Interacting

| Action | Reaction |
|---|---|
| **Click** | Opens her window (agents and chat). If she's asleep, she wakes up and opens it. Closing the window keeps Tera on your desktop. |
| **Drag** | She swings like a pendulum, following your speed, and stays where you drop her. |
| **Move the mouse back and forth** over her | Head pat ♥ |
| **Right-click** her or the tray icon | Menu |

Only Tera herself responds to the mouse. The transparent background lets clicks
through to the window behind.

## Menu

The menu is in Portuguese for now:

| Item | Meaning |
|---|---|
| **Esconder / Mostrar Tera** | Hide or show her (she keeps running in the tray) |
| **Passear pela tela / Ficar parada** | Wander around when idle, or stay put |
| **Uma Tera só / Uma por sessão de agente** | See [one Tera or many](#one-tera-or-many) |
| **Skin** | Change her look (Tera or the classic drawing) |
| **Voltar pro canto** | Bring her back to the corner if she got lost on another monitor |
| **Conectar ao Claude Code** | Install the plugin ([details](./claude-code)) |
| **Conectar sessões já abertas** | Copy `/reload-plugins` for already-open sessions |
| **Deixar o Claude Code falar pela Tera** | Turn optional MCP speech on or off |
| **Abrir com o Windows** | Start with Windows |
| **Sair do Teracota** | Quit |

## One Tera or many

- **Uma Tera só** (default): one Tera follows every session. With more than one session
  open, the speech bubble says which project an alert is about. She only stops
  "working" when **all** sessions stop.
- **Uma por sessão de agente**: each session gets its own Tera (up to 5), with its own
  color and a name tag with the project name. When the session ends, she waves and
  leaves. The first ("home") Tera always stays.

If different agents are open at the same time (e.g. Claude Code and a tool using the
[local API](/en/dev/api)), the label becomes **Agent · project**.

## Where your preferences live

Position, modes and skin are stored in `%APPDATA%\Teracota\config.json`, on your machine.
See also [Privacy](./faq#privacy-and-security).
