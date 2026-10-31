---
description: How to install Teracota on Windows and connect Tera to Claude Code.
---

# Installation

::: info The app speaks Portuguese
The menu and Tera's lines are in Brazilian Portuguese for now. Menu item names are shown
in **bold Portuguese** below, with the English meaning next to them.
:::

## Requirements

- **Windows 10 or 11, 64-bit.** macOS and Linux aren't supported yet (they're on the
  [roadmap](https://github.com/kyotodevIndie/teracota/blob/main/ROADMAP.md)).
- **Claude Code** with plugin support (CLI or desktop app), for Tera to react to Claude.
  Without it, she still works as a desktop pet and through the [local API](/en/dev/api).
- No Node, Python or admin rights needed.

## 1. Download and install

1. Download `Teracota Setup x.y.z.exe` from the
   [releases page](https://github.com/kyotodevIndie/teracota/releases/latest).
2. Run the installer. It installs for your user only, in
   `%LOCALAPPDATA%\Programs\teracota`, adds Start menu and desktop shortcuts, and opens
   Tera when it's done.

::: warning Windows warning (SmartScreen)
The installer is **not code-signed** yet (certificates cost money and this is an
independent project), so Windows shows **"Windows protected your PC"**. Click
**More info → Run anyway**.

The code is open, and the installer is built from it by GitHub Actions. You can also
[build your own](/en/dev/contributing#running-from-source).
:::

## 2. First launch

Tera shows up in the corner of your screen, introduces herself, and her icon appears in
the **system tray** (near the clock). On first launch she also turns on **Abrir com o
Windows** (start with Windows). You can turn it off in the menu.

## 3. Connect to Claude Code

A few seconds after launching, if Claude Code is installed and the plugin isn't, she
says she found Claude Code. Click her to open her window and press **Conectar ao Claude
Code** (connect to Claude Code). She only installs anything after that button.

If the offer doesn't show up, or you'd rather do it yourself:

- **From the menu:** right-click Tera → **Conectar ao Claude Code** (connect to Claude Code).
- **In a terminal** (PowerShell, bash or zsh):
  ```bash
  claude plugin marketplace add kyotodevIndie/teracota; claude plugin install teracota@teracota
  ```
- **Inside Claude Code**, these two commands, **one at a time**:
  ```
  /plugin marketplace add kyotodevIndie/teracota
  /plugin install teracota@teracota
  ```

### Sessions that were already open

New Claude Code sessions are connected automatically. In sessions that were open before
the install, run `/reload-plugins`. The **Conectar sessões já abertas** menu item (connect
open sessions) copies it for you. Restarting the session works too.

### Claude talking through Tera (optional)

Claude can also make Tera speak and react on its own. To turn it on: menu → **Deixar o
Claude Code falar pela Tera** (let Claude Code talk through Tera). See
[Claude Code → Speech via MCP](./claude-code#speech-via-mcp-optional).

## Updating

Quit Tera (menu → **Sair do Teracota**), download the new version and install it **on
top**. No need to uninstall first, and your preferences are kept. To update the plugin:

```bash
claude plugin marketplace update teracota
claude plugin update teracota@teracota
```

## Uninstalling

1. **App:** Windows Settings → **Apps** → **Teracota** → Uninstall.
2. **Plugin**, if installed:
   ```bash
   claude plugin uninstall teracota@teracota
   claude plugin marketplace remove teracota
   ```
3. **MCP speech**, if turned on: `claude mcp remove --scope user teracota`
4. **Preferences** (optional): delete the `%APPDATA%\Teracota` folder.
