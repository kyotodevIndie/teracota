---
description: How to install Teracota on Windows and connect Tera to Claude Code.
---

# Installation

::: info The app speaks Portuguese
The menu and Tera's lines are in Brazilian Portuguese for now. Menu item names are shown
in **bold Portuguese** below, with the English meaning next to them.
:::

## Requirements

- **Windows 10 or 11, 64-bit.** Linux is [experimental](#linux-experimental); macOS isn't
  supported yet (it's on the
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
says she found Claude Code and asks you to click her. **One click** and you're done. She
only installs anything after that click.

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

## Linux (experimental)

There's no Linux installer yet: you run it from source. It was tested on **Arch with
Hyprland** (Wayland); other distros and desktops should work but haven't been validated.
[Reports and help](/en/dev/contributing) are welcome.

```bash
git clone https://github.com/kyotodevIndie/teracota.git
cd teracota
npm install
npm start
```

To build the packaged app: `npm run pack:linux` and run `release/linux-unpacked/teracota`
(or `npm run dist:linux` for an AppImage).

- **Wayland:** the compositor ignores the position a window asks for, so Tera relaunches
  herself through XWayland to sit in the corner and wander.
- **Tray:** needs StatusNotifier support (Waybar's tray has it). GNOME probably needs the
  AppIndicator extension.
- **Start with the system:** not available on Linux yet, so the menu item is hidden.
- **Hyprland:** as a floating window she gets blur, border and shadow, and doesn't follow
  you across workspaces. In `hyprland.conf`:
  ```
  windowrule = match:class ^teracota$, no_blur on
  windowrule = match:class ^teracota$, no_shadow on
  windowrule = match:class ^teracota$, border_size 0
  windowrule = match:class ^teracota$, pin on
  ```

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
