# internal-tools

Agent embedded as a side panel in a CRUD app. Demonstrates the pattern where the agent UI lives inside an existing app shell — not as a standalone chat.

## Run

```bash
pnpm install
pnpm build
pnpm --filter @kibadist/agentui-example-internal-tools dev
# open http://localhost:3012
```

Click any client row in the table. The mock backend emits a `ui.reset` (to clear the previous client's panel), then streams three insight cards specific to that client.

## What's inside

- `components/clients-table.tsx` — the existing app surface (mocked clients table). Selecting a row dispatches `client.summarize`.
- `components/registry.tsx` — `tool.agent-msg` and `tool.insight-card`.
- `app/page.tsx` — two-column layout: main app on the left, `<AgentRenderer>` panel on the right.
- `app/api/agent/[sessionId]/action/route.ts` — receives `client.summarize`, emits `ui.reset` + 3 `ui.append` events with `setTimeout` between them to simulate streaming.

## Pattern

The right-side panel is just an `<AgentRenderer>` scoped to the session. It receives whatever the backend emits — same wire protocol as a full-screen chat. The main app dispatches actions; the panel renders responses. No special "embedded mode."

## Replacing the mock

Swap the action route handler for one that wires a real LLM (via `@kibadist/agentui-llm`) and calls actual analytics tools (`@kibadist/agentui-node`'s `emitToolCall`). UI stays the same.

## Limitations

The action handler fires its event sequence with `void runSummarize(...)` and no error recovery. A real backend should catch errors and emit a terminal `ui.toast` or `tool.result` (`status: "error"`) so the panel doesn't appear stuck mid-load.
