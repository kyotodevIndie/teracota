---
description: How to contribute to Teracota (code, skins, integrations, docs).
---

# Contributing

Every contribution counts: reporting a bug, suggesting an idea, writing code, drawing a
skin, integrating another agent or improving these docs.

The full guide (code style, tests, commits and pull requests) is
**[CONTRIBUTING.md](https://github.com/kyotodevIndie/teracota/blob/main/CONTRIBUTING.md)**.
It's written in Brazilian Portuguese; issues and PRs in English are welcome too. This page
is the quick path.

## Running from source

You need **Node.js 22+**. Windows is the supported platform; Linux is experimental.

```bash
git clone https://github.com/kyotodevIndie/teracota.git
cd teracota
npm install
npm start          # build and launch the app ("Teracota Dev")
npm run check      # typecheck + lint + tests (run before opening a PR)
npm run dist       # build the installer into release/
npm run docs:dev   # this site, at http://localhost:5173/teracota/
```

When running from source, the app is named **Teracota Dev** and can run alongside the
installed Teracota. Only the port is shared: use `TERACOTA_PORT=7788 npm start` if the
installed one is running.

## Where to start

| I want to... | Read |
|---|---|
| Understand the architecture | [Architecture](./architecture) |
| Integrate another coding agent | [Agent integrations](./integrations) |
| Make Tera react to my own tool | [Local API](./api) |
| Draw a skin | [Creating skins](./skins) |
| See what's planned | [ROADMAP](https://github.com/kyotodevIndie/teracota/blob/main/ROADMAP.md) |
| Pick up a task | [`good first issue`](https://github.com/kyotodevIndie/teracota/labels/good%20first%20issue) issues |

## Rules enforced by CI

- `npm run check` must pass: typecheck, lint (Biome) and tests (Vitest).
- **Nothing agent-specific outside `src/main/integrations/<agent>/`.** A test enforces it.
- **Never get in the agent's way:** integrations fail silently when the app is closed.

## Community

- [Code of Conduct](https://github.com/kyotodevIndie/teracota/blob/main/CODE_OF_CONDUCT.md)
- [Security](https://github.com/kyotodevIndie/teracota/blob/main/SECURITY.md): report
  vulnerabilities privately, not in public issues.
- [Changelog](https://github.com/kyotodevIndie/teracota/blob/main/CHANGELOG.md)
