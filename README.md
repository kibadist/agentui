# AgentUI

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange?logo=pnpm)](https://pnpm.io/)
[![packages](https://img.shields.io/badge/packages-8-blueviolet)](./docs/packages.md)

**An AI-native component system for agent-driven UIs.**

Instead of letting a model generate raw HTML or JSX (unsafe, unpredictable, impossible to style consistently), AgentUI gives LLM agents a typed event protocol to **compose, update, and remove UI components** — all validated against a schema and rendered through a developer-controlled registry.

<p align="center">
  <img src="examples/agentui demo (1).gif" alt="AgentUI demo" width="800" />
</p>

---

## How it works

The agent emits structured **UI events**. Your frontend renders them through a **whitelisted component registry** you control. User interactions return as **action events** on the same SSE-backed session.

```mermaid
flowchart LR
  Agent["🤖 Agent (LLM)"]
  NestJS["⚙️ NestJS"]
  React["⚛️ React"]
  Components["🧩 Components"]

  Agent -- "emit_ui_event\n(tool call)" --> NestJS
  NestJS -- "SSE stream\n(UIEvent)" --> React
  React -- "registry\nlookup" --> Components
  Components -- "user click\n(ActionEvent)" --> Agent
```

```tsx
import { createRegistry, AgentRoot, AgentRenderer } from '@kibadist/agentui-react';

const registry = createRegistry({
  'data-table': DataTable,
  'info-card':  InfoCard,
});

export function App() {
  return (
    <AgentRoot endpoint="/api/agent">
      <AgentRenderer registry={registry} />
    </AgentRoot>
  );
}
```

For the full walkthrough see [Concepts](./docs/concepts.md) and [Getting Started](./docs/getting-started.md).

---

## Documentation

### Start here

- [Getting Started](./docs/getting-started.md) — prereqs, install, dev server, example prompts
- [Concepts](./docs/concepts.md) — the problem, the typed-event approach, the flow
- [Wire Protocol](./docs/wire-protocol.md) — every operation, with payload examples

### Guides — Client (`@kibadist/agentui-react`)

- [`<AgentRoot>`](./docs/guides/agent-root.md)
- [Renderer](./docs/guides/renderer.md)
- [State selectors](./docs/guides/state-selectors.md)
- [Tool calls](./docs/guides/tool-calls.md)
- [Reasoning](./docs/guides/reasoning.md)
- [Workflows / steppers](./docs/guides/workflows.md)
- [Optimistic updates](./docs/guides/optimistic.md)
- [Schema-first nodes](./docs/guides/schema-first-nodes.md)
- [Stream resilience](./docs/guides/stream-resilience.md)
- [Memory caps & metrics](./docs/guides/memory-caps.md)
- [Testing](./docs/guides/testing.md)
- [DevTools panel](./docs/guides/devtools.md)

### Guides — Server

- [Server companion (Node)](./docs/guides/server-node.md)
- [LLM adapters](./docs/guides/llm-adapters.md)
- [JSON Schema export](./docs/guides/json-schema-export.md)

### Guides — Tooling

- [CLI generator](./docs/guides/cli-generator.md)

### Reference

- [Packages](./docs/packages.md) — full package matrix + dependency graph
- [Use Cases](./docs/use-cases.md)
- [Roadmap](./docs/roadmap.md)
- [Stability](./STABILITY.md) — what's covered by semver
- [Migration: 0.x → 1.0](./MIGRATION-1.0.md)
- [Changelog](./CHANGELOG.md)

---

## Packages

| Package | npm | Purpose |
|---------|-----|---------|
| [`@kibadist/agentui-protocol`](https://www.npmjs.com/package/@kibadist/agentui-protocol) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-protocol)](https://www.npmjs.com/package/@kibadist/agentui-protocol) | TypeScript types for the wire protocol |
| [`@kibadist/agentui-validate`](https://www.npmjs.com/package/@kibadist/agentui-validate) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-validate)](https://www.npmjs.com/package/@kibadist/agentui-validate) | Zod schemas + parsers + JSON Schema files |
| [`@kibadist/agentui-react`](https://www.npmjs.com/package/@kibadist/agentui-react) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-react)](https://www.npmjs.com/package/@kibadist/agentui-react) | Registry, renderer, SSE hook, action context |
| [`@kibadist/agentui-node`](https://www.npmjs.com/package/@kibadist/agentui-node) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-node)](https://www.npmjs.com/package/@kibadist/agentui-node) | Framework-agnostic Node/Web server primitives |
| [`@kibadist/agentui-nest`](https://www.npmjs.com/package/@kibadist/agentui-nest) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-nest)](https://www.npmjs.com/package/@kibadist/agentui-nest) | Session event bus + controller factory for NestJS |
| [`@kibadist/agentui-ai`](https://www.npmjs.com/package/@kibadist/agentui-ai) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-ai)](https://www.npmjs.com/package/@kibadist/agentui-ai) | Provider-agnostic adapter via Vercel AI SDK |
| [`@kibadist/agentui-llm`](https://www.npmjs.com/package/@kibadist/agentui-llm) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-llm)](https://www.npmjs.com/package/@kibadist/agentui-llm) | Provider-native LLM stream adapters |
| [`@kibadist/agentui-next`](https://www.npmjs.com/package/@kibadist/agentui-next) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-next)](https://www.npmjs.com/package/@kibadist/agentui-next) | SSE + action proxy for Next.js App Router |

See [Packages](./docs/packages.md) for the dependency graph.

---

## Starter templates

Three reference projects in `examples/`. Each runs standalone with a mock SSE backend (no separate Nest server needed).

| Example | Port | Demonstrates |
|---|---|---|
| [`chat-starter`](./examples/chat-starter) | 3010 | Minimal Next.js + `<AgentRoot>` + a single-process mock SSE backend |
| [`support-bot`](./examples/support-bot) | 3011 | Multi-turn agent with tool calls, reasoning trace, and file upload stub |
| [`internal-tools`](./examples/internal-tools) | 3012 | Agent embedded as a side panel in a mock CRUD app |

Run any of them:

```bash
pnpm install
pnpm build
pnpm --filter @kibadist/agentui-example-chat-starter dev
```

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, test bar, and PR conventions. Protocol-level proposals go through [`rfcs/`](./rfcs/).

```bash
pnpm build        # build all packages
pnpm test         # run tests across workspace
pnpm typecheck    # tsc --noEmit
```

---

## License

MIT © [Maksym Ivashchenko](https://github.com/kibadist)
