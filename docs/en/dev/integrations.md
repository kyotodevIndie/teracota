---
description: Teracota's adapter architecture, capabilities, per-agent status and how to integrate a new agent.
---

# Agent integrations

Teracota isn't tied to Claude Code. The architecture supports multiple coding agents
through independent **adapters**. The long-term goal:

> **Connect your coding agent and give it a life on your desktop.**
> Instead of "Desktop pet for Claude Code".

Claude Code remains the first-class integration, while Teracota becomes vendor-independent.

```
                         TERACOTA
                             │
                      Companion Core
              (manager, sessions, Teras, renderer)
                             │
                   AgentSignal / CompanionEvent
                             │
        ┌──────────────┬─────┴────────┬──────────────────┐
        ▼              ▼              ▼                  ▼
 Claude Code      Codex adapter   OpenCode adapter   Universal local API
   adapter        (planned)       (planned)          (any tool)
        │              │              │                  │
        ▼              ▼              ▼                  ▼
   Claude Code    OpenAI Codex     OpenCode        "My agent"
```

## The main rule

**No agent-specific behavior goes into the core, the renderer or `Character`.** Each
integration translates its agent's native events into Teracota's normalized protocol:

```
Claude Code                               OpenCode (planned)
PreToolUse(Edit)                          tool.execute.before
      ↓                                         ↓
ClaudeCodeAdapter                         OpenCodeAdapter
      ↓                                         ↓
AgentSignal { source, working: true,      AgentSignal { source, working: true,
  event: { state: "typing" } }              event: { state: "typing" } }
```

The renderer doesn't know which agent sent an event, and there's no `isClaude`,
`isCodex` or `isOpenCode` scattered around. This rule is **enforced by a test**
(`src/main/integrations/integrations.test.ts`): CI fails if something agent-specific
shows up outside `src/main/integrations/`.

## How it's implemented today

```
src/main/integrations/
  types.ts                  contract: AgentAdapter, AgentSignal, AgentCapabilities
  index.ts                  adapter registry + capabilities for community integrations
  claude-code/
    adapter.ts              Claude Code hooks → AgentSignal
    connect.ts              CLI connection: installs the plugin; toggles MCP speech
    adapter.test.ts
```

### The contract (`types.ts`)

```ts
interface AgentAdapter {
  id: string;                        // stable slug: "claude-code"
  displayName: string;               // "Claude Code" (shown in bubbles/name tags)
  capabilities: AgentCapabilities;
  routes: string[];                  // local HTTP routes receiving native events
  toSignal(body: unknown): AgentSignal | null;
  connect?: AgentConnector;          // optional: menu items (connect, open sessions, speech)
}

interface AgentSignal {
  source: { provider: string; sessionId: string; project: string };
  lifecycle?: 'start' | 'end';       // session start/end
  working?: boolean;                 // started/finished working
  mcpCall?: boolean;                 // the next MCP call comes from this session
  event: CompanionEvent | null;      // what to show (state, speech...)
}
```

The core (`manager.ts`) only receives `AgentSignal`s. It tracks sessions by
`provider:sessionId`, decides which Tera shows what (one Tera or one per session) and
builds the origin label. When different agents are open at once, bubbles and name tags
show **"Agent · project"** (e.g. `Claude Code · api`, `Codex · hera`); with a single agent,
just the project.

## Capability model

Not every agent has the same events. Each adapter **declares** what it can report, and
Teracota offers the best experience it can with that, without faking features.

```ts
interface AgentCapabilities {
  sessions: boolean;      // identifies sessions and project → one Tera per session
  toolEvents: boolean;    // reading, editing, terminal...
  fileEvents: boolean;    // edited files
  permissions: boolean;   // asked for permission → Tera waves
  errors: boolean;        // failures → Tera confused
  completion: boolean;    // finished → Tera celebrates
  messages: boolean;      // user/agent messages
  mcp: boolean;           // talks to Teracota's MCP (say/emote)
}
```

Capabilities already change behavior today: **without `completion`**, "working" expires
after 1 min without events (instead of 10), so Tera never gets stuck working forever.
Future integrations should add new uses as real needs show up.

| | Claude Code | Community integration (local API) |
|---|:-:|:-:|
| Sessions | ✓ | ✓ (when sending `source`) |
| Tools | ✓ | — |
| Files | — (arrive as tools) | — |
| Permissions | ✓ | — |
| Errors | ✓ | — |
| Completion | ✓ | — |
| Messages | ✓ | — |
| MCP | ✓ | — |

## Status per agent

### Claude Code: **SUPPORTED** (reference integration)

A plugin with hooks via `curl`. MCP speech (served by the app) is optional and kept out
of the plugin, so a closed app never causes errors. Keep: hooks, MCP, sessions,
permissions, tool activity, multiple sessions, `say` and `emote`.

### OpenAI Codex: **PLANNED, high priority**

- Research the official interfaces available at implementation time.
- Prioritize events equivalent to: session started, thinking, reading, editing, running a
  command, permission needed, error, task completed, session ended.
- Build **only on stable or reasonably supported interfaces**. Don't scrape the UI/TUI
  when a better official integration exists.
- **Don't announce support before validating the real flow.**

### OpenCode: **PLANNED, high priority**

OpenCode has a plugin and event architecture that fits Teracota well. The integration
should be an **OpenCode plugin**, without modifying OpenCode. Initial mapping:

| OpenCode event | Signal |
|---|---|
| `session.created` | `lifecycle: 'start'` |
| `session.status` | `working` according to status |
| `session.error` | `state: 'error'` |
| `tool.execute.before` | `working: true` + state by tool (`typing`, `terminal`...) |
| `tool.execute.after` | — (or back to `thinking`) |
| `file.edited` | `state: 'typing'` |
| `permission.asked` | `state: 'attention'` + "I'm waiting for you!" |
| `permission.replied` | back to the previous state |

## Checklist before integrating a new agent

1. Is there an **official** API, plugin system or hook?
2. Are there session events?
3. Are there tool events?
4. Are there permission events?
5. Can we identify the project or workspace?
6. Can we detect completion?
7. Does the integration work **without a mandatory external runtime** on the user's machine?
8. Does the agent keep working normally with Teracota **closed**?

If the answers aren't good enough, **don't build it yet**. Meanwhile, the
[local API](./api) already allows an unofficial integration.

## Writing an adapter

1. Create `src/main/integrations/<agent>/adapter.ts` exporting an `AgentAdapter`.
2. Pick a route of its own, e.g. `/integrations/<agent>`. The server registers every
   adapter's routes automatically.
3. In `toSignal`, validate the native JSON and translate it into an `AgentSignal`.
   **Never throw**: return `null` to ignore. The agent must never be disrupted.
4. Declare capabilities honestly.
5. Register it in `ADAPTERS` (`src/main/integrations/index.ts`).
6. On the agent's side (plugin, hook, extension), send events over HTTP to
   `127.0.0.1:7777/<your route>`, with a short timeout and failing silently when the app
   is closed. Avoid requiring Node or Python on the user's machine.
7. If the agent can install the integration from a CLI, implement `connect`: the menu
   gets a "Connect to &lt;agent&gt;" item automatically.
8. Write `toSignal` tests (see `apps/desktop/src/main/integrations/claude-code/adapter.test.ts`) and run `pnpm check`.

## Universal local API

`POST /api/v1/event` (with `/event` as a compatible alias) accepts a `CompanionEvent` and,
optionally, a `source`. **With `source`, a tool gets sessions, an origin label and its own
Tera in one-per-session mode**, with no official adapter. Full spec in [Local API](./api).

## Community adapters

The future goal is for the community to write adapters without touching the core. For
now the layout is `src/main/integrations/<agent>/`. Later this may become external plugins
(`teracota-adapter-foo`).

**No plugin runtime for now.** First, validate at least three real integrations (Claude
Code, Codex and OpenCode). Then extract a public API based on what they actually needed.
No SDK designed on hypotheses.

## Milestones

1. **Companion Core:** ✅ adapter architecture, capabilities, agent identity and local API
   v1, all in the first public beta (v0.1). Claude Code remains the only official
   integration.
2. **v0.2 to v0.4:** focus sessions, visual improvements and multiple Teras. These don't
   wait for new agents.
3. **Adapter #2:** OpenCode or Codex, whichever has the more mature official integration
   at the time. Goal: prove the adapter architecture really works.
4. **Adapter #3:** the other one. Goal: validate the abstraction across three different
   systems.
5. **Adapter SDK:** a minimal public API for community integrations, only after learning
   from all three.
