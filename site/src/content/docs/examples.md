---
title: "Examples"
description: "Five runnable example apps in the monorepo — from a single-process mock chat to a full split backend + frontend with a real LLM."
---

The monorepo ships **five example apps** under [`examples/`](https://github.com/kibadist/agentui/tree/main/examples). They're workspace members (not published) and each runs on its own port, so you can run several at once.

Three are **single-process with a mock backend** — no API key, no separate server, in-process route handlers stand in for the agent. Two are a **split backend + frontend** that talk over SSE, with the backend driving a real LLM.

| Example | Port | Backend | Needs API key | Start here if… |
|---------|------|---------|---------------|----------------|
| [`chat-starter`](https://github.com/kibadist/agentui/tree/main/examples/chat-starter) | 3010 | mock (Next.js routes) | no | you want the smallest end-to-end loop |
| [`support-bot`](https://github.com/kibadist/agentui/tree/main/examples/support-bot) | 3011 | mock (Next.js routes) | no | you want tool calls + reasoning UI |
| [`internal-tools`](https://github.com/kibadist/agentui/tree/main/examples/internal-tools) | 3012 | mock (Next.js routes) | no | you're embedding the agent in an existing app |
| [`nest-api`](https://github.com/kibadist/agentui/tree/main/examples/nest-api) | 3001 | NestJS | optional* | you want the real server-side pattern |
| [`next-app`](https://github.com/kibadist/agentui/tree/main/examples/next-app) | 3000 | (pairs with `nest-api`) | — | you want the production client wiring |

<small>\* `nest-api` falls back to deterministic mock UIEvents if `ANTHROPIC_API_KEY` is unset, so it runs with no key too.</small>

Run any example with:

```bash
pnpm install            # at the repo root
pnpm build              # build all workspace packages first
pnpm --filter @kibadist/agentui-example-<name> dev
```

## Single-process (mock backend)

These need no API key and no separate server — the "backend" is a set of in-process Next.js route handlers under `app/api/agent/*`. They're the fastest way to see the protocol and registry without wiring an LLM.

### chat-starter — `:3010`

The minimal end-to-end loop. A two-component registry (`chat.message`, `chat.text`), `useAgentStream` + `AgentRenderer` on the client, and three route handlers (`session`, `stream`, `action`) for the mock backend. This is the one embedded as a live StackBlitz playground on the [Getting Started](/agentui/getting-started) page.

### support-bot — `:3011`

A multi-turn agent UI: tool calls, a reasoning trace, and a file-upload stub. The mock backend echoes your message, then streams a scripted sequence — the point is the **UI patterns** (see the [Tool calls](/agentui/guides/tool-calls) and [Reasoning](/agentui/guides/reasoning) guides), not the LLM wiring.

### internal-tools — `:3012`

The agent embedded as a **side panel inside a CRUD app** — the "agent inside an app shell" pattern, not a standalone chat. Click a client row and the mock backend emits a `ui.reset` (clearing the previous panel), then streams insight cards for that client. Demonstrates `ui.reset` for scoping UI to a selection.

## Split backend + frontend (real LLM)

These two run together: start `nest-api` first, then `next-app`.

### nest-api — `:3001`

A NestJS backend wired to a real Anthropic agent via `runAgentLoop` (`@kibadist/agentui-ai`). The controller is built from `@kibadist/agentui-nest`'s `createAgentController`, exposing:

- `POST /agent/session` → `{ sessionId }`
- `GET  /agent/:sessionId/stream` → SSE stream of UIEvents
- `POST /agent/:sessionId/action` → submit an `ActionEvent`

Component types and props are defined once as Zod schemas (`COMPONENT_DEFS`) and turned into the system prompt with `describeComponents`. Set `ANTHROPIC_API_KEY` in `examples/nest-api/.env` for a real LLM; without it the service returns mock UIEvents. `test-client.sh` is a curl smoke test for the three endpoints. See [LLM adapters](/agentui/guides/llm-adapters).

### next-app — `:3000`

A Next.js App Router frontend with a **custom component registry** — the five whitelisted types (`text-block`, `info-card`, `action-card`, `data-table`, `status-badge`) mirror what the `nest-api` agent is allowed to emit. It creates a session on mount, then wires `useAgentStream` → `AgentStateProvider`/`AgentActionProvider` → `AgentRenderer` + `ToastList`, with `ChatInput` sending `chat.send` actions and `AgentDevTools` mounted for inspection. Override the backend URL with `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3001`). See [Renderer](/agentui/guides/renderer) and [DevTools](/agentui/guides/devtools).

The registry is the **security boundary**: only types registered via `createRegistry` can render. To add a component, register it here *and* allow the backend agent to emit it.
