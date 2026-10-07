---
description: Frequently asked questions and troubleshooting for Teracota.
---

# FAQ & troubleshooting

## Tera doesn't react to Claude Code

Check, in this order:

1. **Is Teracota running?** Her icon should be in the system tray.
2. **Is the plugin installed?** Run `claude plugin list`; you should see `teracota@teracota`.
   If not, see [Connect to Claude Code](./installation#_3-connect-to-claude-code).
3. **Was the session opened before the plugin was installed?** Run `/reload-plugins` in it,
   or restart the session.
4. **Is the app listening?** This should make Tera jump and say "hi":
   ```bash
   curl -X POST http://127.0.0.1:7777/api/v1/event -H "Content-Type: application/json" -d '{"state":"happy","say":"hi"}'
   ```
   If it doesn't, another program may be using port `7777`.

## Events arrive twice

There are two active integrations for the same Claude Code: for example the plugin
**and** hooks set up by hand in `.claude/settings.local.json`. Keep only one.

## Claude Code shows an MCP connection error for "teracota"

**MCP speech** is on and Teracota is closed. Open the app (and run `/mcp` to reconnect),
or turn speech off in Tera's menu ([details](./claude-code#speech-via-mcp-optional)). The
plugin alone never causes this error.

## Tera disappeared

Right-click her tray icon → **Voltar pro canto** (back to the corner). If she's hidden, use
**Mostrar Tera** (show Tera).

## I can't click her

Only Tera herself responds to the mouse; the transparent background lets clicks through
on purpose. If even Tera doesn't respond,
[open a bug](https://github.com/kyotodevIndie/teracota/issues/new/choose) saying what you were
doing right before (dragging, her walking, switching monitors...) and which monitors and
scaling you use.

## Windows says it protected my PC

That's SmartScreen, because the installer isn't code-signed yet. Click
**More info → Run anyway**. Details in [Installation](./installation#_1-download-and-install).

## Is she heavy on my computer?

When idle, Tera uses about **5% of one CPU core** and around **400 MB** of memory (it's
an Electron app). She lowers her frame rate when idle or asleep. In one-per-session mode,
each extra Tera is another window.

## Does she slow Claude Code down?

Barely. Each event is a local `curl` that takes milliseconds. With the app closed it fails
instantly. If the app hangs, `curl` gives up within 2 seconds.

## Privacy and security

- Everything runs **on your machine**. The app listens only on `127.0.0.1` and **sends
  nothing to the internet**.
- The JSON Claude Code gives to hooks includes event details, including what a tool
  received. Teracota reads only the event name, session id, project folder and tool name,
  and **stores and forwards nothing**.
- The local server rejects requests from web pages (`Origin` header) and other hosts
  (DNS rebinding). Events only change what Tera shows; they don't run anything.
- The app only stores your preferences (`%APPDATA%\Teracota\config.json`).
- On launch it runs **read-only** Claude CLI commands (`claude plugin list`,
  `claude mcp get teracota`) to check whether the integration is active. It only installs or
  removes something when you ask (by clicking the offer or from the menu).
- Found a vulnerability? See the [security policy](https://github.com/kyotodevIndie/teracota/blob/main/SECURITY.md).

## Does it work on macOS or Linux?

Linux is **experimental** (see [how to run it](./installation#linux-experimental)); macOS
isn't yet. Both are on the
[roadmap](https://github.com/kyotodevIndie/teracota/blob/main/ROADMAP.md), and help is welcome.

## Does it work with other agents (Codex, OpenCode...)?

The only official integration today is **Claude Code**. OpenCode and Codex adapters are
**planned** but don't exist yet. Meanwhile, any tool can make Tera react through the
[local API](/en/dev/api).

## Why is the app in Portuguese?

It started as a Brazilian project. English for the app's menu and lines is on the roadmap.
Translations are welcome.

## Is this an Anthropic product?

No. Teracota is an independent open source project, not affiliated with Anthropic.

## How do I quit for good?

Menu → **Sair do Teracota** (quit). To stop her from starting with Windows, uncheck
**Abrir com o Windows** in the menu.
