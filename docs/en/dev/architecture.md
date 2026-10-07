---
description: Teracota's layers, contracts and technical decisions.
---

# Architecture

A technical overview for contributors. To install and use the app, see the
[user guide](/en/guide/installation). Agents and adapters: [Agent integrations](./integrations).
Local API: [Local API](./api).

## Stack

| Layer | Technology |
|---|---|
| App | Electron (main + preload + renderer), no UI framework: DOM, Canvas 2D and SVG |
| Language | Strict TypeScript |
| Build | esbuild (`build.mjs`); types checked separately with `tsc --noEmit` |
| Integration | Per-agent adapters (Claude Code: hooks via `curl`) + local API + optional MCP (`@modelcontextprotocol/sdk`) served by the app |
| Tests | Vitest (pure logic, a real HTTP server, and the core with Electron mocked) |
| Lint | Biome (linter only) |
| Packaging | electron-builder (Windows NSIS installer; AppImage on Linux, experimental) |
| CI | GitHub Actions: `ci.yml` (checks), `release.yml` (tag → installer → draft release), `docs.yml` (this site) |

## Overview

```
 Claude Code ─ hooks (curl) ─► POST /hook ──────┐
 (other agents: future adapters)                │  adapter → AgentSignal
 Any tool ─► POST /api/v1/event ────────────────┤  (optional source)
 Optional MCP (say/emote) ─► POST /mcp ─────────┤
                                                ▼
┌──────────── Main process (Electron main) ──────────────────┐
│ server.ts        local HTTP, 127.0.0.1 only                │
│ integrations/    adapters: native → AgentSignal            │
│ platform/        what varies per OS/compositor             │
│ manager.ts       Companion Core: sessions → which Tera     │
│ sessions.ts      sessions keyed by provider:sessionId      │
│ entity.ts        one Tera = BrowserWindow + Walker + IPC   │
│ walker.ts        wandering (moves the window)              │
│ skins.ts         skins + click masks                       │
│ menu.ts, main.ts menu, tray, lifecycle                     │
└──────────────┬─────────────────────────────────────────────┘
               │ IPC (shared/ipc.ts) — window.teracota in the preload
               ▼
┌──────────── Renderer (one page per Tera) ──────────────────┐
│ app.ts            states, reactions, mouse, drag, speech   │
│ character.ts      Character interface (pluggable)          │
│ sprite-character  sprite skin on a <canvas>                │
│ svg-character     SVG drawing ("classic")                  │
│ wobble.ts         procedural motion                        │
│ pendulum.ts       swing physics while dragged              │
└────────────────────────────────────────────────────────────┘
```

**Layers and dependency rule:** adapters → core → renderer. Only adapters know about a
specific agent. The core only knows `AgentSignal` and `CompanionEvent`, and the renderer
only knows `CompanionEvent`. A test makes sure nothing agent-specific leaks out of
`src/main/integrations/`.

## Contracts

### `CompanionEvent` (`src/shared/protocol.ts`)

What Tera should show: `state`, `expression`, `anim`, `say`, `duration`, `working`, and
`from` (the origin label, built by the core). States and their sprite poses live in
`src/renderer/states.ts`. Tool states expire after 8 s and fall back to `thinking`.

### `AgentSignal` (`src/main/integrations/types.ts`)

What an adapter produces: `source` (provider, session, project), `lifecycle`, `working`,
`mcpCall` and `event`. See [Agent integrations](./integrations).

### Routing (`src/main/manager.ts`)

- Session key: `provider:sessionId`, so different agents never collide.
- **One Tera mode:** a single Tera receives everything. `working` is true if any session
  is working. With more than one session, lines get a `from` label.
- **One per session mode:** up to 5 Teras. The first one ("home") never leaves and is the
  only one that remembers its position. On `lifecycle: 'end'`, a Tera waves and leaves.
- **Label:** the project, or `Agent · project` when different agents are open. It updates
  itself when an agent joins or leaves.
- **Ghost sessions:** removed after 45 min without events. "Working" expires after 10 min,
  or after 1 min if the agent doesn't declare `completion`.
- **MCP → right session:** a signal with `mcpCall` marks the session, and an MCP call
  arriving within 5 s goes to that session's Tera.

### IPC (`src/shared/ipc.ts`)

`window.teracota`: main → renderer: `onEvent`, `onWalk`, `onCursor` (every 33 ms),
`onMode`, `onIdentity`, `onLeave`, `getSkin`. Renderer → main: `setIgnoreMouse`,
`openContextMenu`, `moveBy`, `dragEnd`, `setWalkAllowed`, `notifyClick`.

### `Character` (`src/renderer/character.ts`)

`show(look)`, `setProp`, `setMotion('walk'|'drag'|null, dir)`, `setTalking`, `setSwing`,
`lookAt` and `hitTest`. `SpriteCharacter` works with **poses**; `SvgCharacter` with
**expression + CSS animation**. A new kind of character (Live2D, cut-out rig) only needs
to implement this interface.

### Skins

`assets/skins/<id>/skin.json` or `%APPDATA%/Teracota/skins/<id>/`. Format in
[Creating skins](./skins).

## Decisions and constraints

1. **End users don't need Node.** Integrations use local HTTP; hooks use `curl`.
2. **Never get in the agent's way.** Adapter routes always answer 204. Hooks use a short
   timeout and `|| exit 0`. With the app closed, nothing breaks.
3. **Local only.** The server listens on `127.0.0.1` and rejects any `Origin` header or
   unexpected `Host`. Events only change visuals.
4. **Performance matters.** Idle: ~5% of one core and ~400 MB. Frames are pre-scaled and
   the frame rate adapts (60 while moving, 24 idle, 15 asleep).
5. **Click-through windows are fragile on Windows.** Hover detection comes from the
   cursor position polled by the main process and tested against the frame's alpha mask;
   the state is re-asserted every second.
6. **One `BrowserWindow` per Tera.** Wandering moves the window.
7. **Assets live outside the `.asar`** (`extraResources`), since they're read via
   `file://` and `nativeImage`.
8. **Dev build separate from the installed app:** unpackaged, the app is named "Teracota
   Dev" with its own config and single-instance lock. `TERACOTA_PORT` changes the port.

## Known limitations

- Only 4 frames per animation; the activity icon doesn't adapt to each pose.
- MCP speech is optional: if you turn it on and close the app, Claude Code shows an MCP
  connection error.
- No automated tests for real Electron windows, the renderer, or end-to-end flows.
- macOS and Linux aren't built or tested; the Windows installer isn't signed and has no
  auto-update.
