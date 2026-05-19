# AgentUI

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange?logo=pnpm)](https://pnpm.io/)
[![packages](https://img.shields.io/badge/packages-6-blueviolet)](#packages)

**An AI-native component system for agent-driven UIs.**

Instead of letting a model generate raw HTML or JSX (unsafe, unpredictable, impossible to style consistently), AgentUI gives LLM agents a typed event protocol to **compose, update, and remove UI components** — all validated against a schema and rendered through a developer-controlled registry.

<p align="center">
  <img src="examples/agentui demo (1).gif" alt="AgentUI demo" width="800" />
</p>

---

## The Problem

Most AI chat interfaces look the same: a text bubble stream. But real agentic apps need richer output — tables, cards, task boards, status dashboards — rendered safely and consistently.

The naive approach is to have the LLM write JSX or HTML directly. This breaks in practice:

- Output is inconsistent and hard to style
- No validation — the model can emit anything
- No interactivity feedback loop back to the agent
- Impossible to maintain design system coherence

---

## The Solution

AgentUI introduces a **UI event protocol** between your agent and your frontend:

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

The agent never touches your DOM. It emits **structured events**. Your frontend renders them through a **whitelisted component registry** you control.

---

## How It Works

### 1. The agent emits a typed UI event

Instead of writing `<table>...</table>`, the agent calls a tool:

```json
{
  "op": "append",
  "id": "sales-table",
  "component": "data-table",
  "props": {
    "columns": ["Product", "Revenue", "Growth"],
    "rows": [
      ["Pro Plan", "$48,200", "+12%"],
      ["Starter", "$18,700", "+4%"]
    ]
  }
}
```

### 2. AgentUI validates and streams it

The backend validates the event with Zod, then streams it to the client over SSE.

```typescript
// NestJS controller — one line of setup
const controller = createAgentController({ agent, tools });
```

### 3. React renders it through your registry

```typescript
import { createRegistry, AgentUIProvider, AgentRenderer } from '@kibadist/agentui-react';

const registry = createRegistry({
  'data-table': DataTable,
  'info-card':  InfoCard,
  'text-block': TextBlock,
  'task-board': TaskBoard,
  'stat-card':  StatCard,
});

export function App() {
  return (
    <AgentUIProvider registry={registry} sessionId="demo">
      <Chat />
      <AgentRenderer />
    </AgentUIProvider>
  );
}
```

Only components in your registry can be rendered. The model cannot escape the sandbox.

### 4. User actions route back to the agent

```typescript
import { useAgentAction } from '@kibadist/agentui-react';

function TaskCard({ id, title, status }) {
  const dispatch = useAgentAction();

  return (
    <button onClick={() => dispatch({ type: 'task.complete', payload: { id } })}>
      Complete
    </button>
  );
}
```

User interactions are sent back as `ActionEvent`s — the agent can react to them and emit new UI events in response.

---

## Supported UI Operations

| Operation | Description |
|-----------|-------------|
| `append` | Add a new component to the canvas |
| `replace` | Swap props on an existing component |
| `remove` | Delete a component by ID |
| `toast` | Show a transient notification |
| `navigate` | Trigger client-side navigation |
| `reset` | Clear all UI state (end-of-conversation, summarizer flush) |

### JSON Patch payloads for `ui.replace`

For deeply nested or large nodes, agents can emit minimal [RFC 6902](https://datatracker.ietf.org/doc/html/rfc6902) JSON Patch deltas instead of full props snapshots:

````ts
{
  op: "ui.replace",
  key: "todo-list",
  patch: [
    { op: "replace", path: "/items/3/status", value: "done" }
  ]
}
````

- Paths target the node's `props` object (root `""` means props itself).
- All ops are supported: `add`, `remove`, `replace`, `move`, `copy`, `test`.
- All-or-nothing: any failing op aborts the patch and surfaces via `onInvalidEvent`.
- Use full `props` for simple updates; use `patch` when the diff is small relative to the node.

Both forms can interleave for the same key.

### Resetting a conversation

```tsx
const { state, reset } = useAgentStream({ url, sessionId });
useEffect(() => { reset(); }, [sessionId, reset]); // fresh state on session change
```

Migrating from a hand-rolled `agentNodeOffset` workaround: delete the offset bookkeeping and call `reset()` instead — the reducer now hands back fresh `nodes` / `byKey` references on every reset, so there's nothing to subtract from.

### Renderer: range, filter, hiddenTypes, errorFallback, nodeWrapper

`AgentRenderer` accepts five optional props for slicing, hiding, error containment, and wrapping (e.g., for animation):

```tsx
<AgentRenderer
  state={state}
  registry={registry}
  range={{ start: lastSeenIndex, end: state.nodes.length }}   // paginate
  hiddenTypes={['panel-patch']}                               // hide structural nodes
  errorFallback={(err, node) => <ErrorCard message={err.message} nodeKey={node.key} />}
  nodeWrapper={(node, children) => (
    <motion.div key={node.key} layout>{children}</motion.div>
  )}
/>
```

Composition order is `slot → range → filter → hiddenTypes`. All five default to no-op, so existing call sites need no changes.

### Granular state selectors

`useAgentStream` exposes a subscribable `store`; wire it into `<AgentStateProvider>` and consumers below it can subscribe to derived slices without re-rendering on unrelated events.

```tsx
function App({ url, sessionId }: { url: string; sessionId: string }) {
  const { store, status } = useAgentStream({ url, sessionId });
  return (
    <AgentStateProvider store={store}>
      <Chat />     {/* anywhere inside: useAgentNodes(), useAgentToasts(), ... */}
    </AgentStateProvider>
  );
}

function Chat() {
  const nodes  = useAgentNodes();          // re-renders only when nodes change
  const toasts = useAgentToasts();         // re-renders only when toasts change
  const count  = useAgentSelector((s) => s.nodes.length);  // arbitrary derived state
}
```

For a custom equality function (e.g., to keep a selector ref-stable across notifications):

```tsx
const status = useAgentSelector(
  (s) => ({ id: s.nodes[0]?.key ?? null }),
  (a, b) => a.id === b.id,
);
```

`useAgentStream().state` keeps working — selectors are additive. The detailing-app pattern of splitting "stream-hot" and "session-stable" contexts collapses into a single `<AgentStateProvider>`.

### Tool calls

Stream-LLM tool calls have a built-in state slice and a headless renderer. Wire events: `tool.start`, `tool.args-delta`, `tool.result`, `tool.cancel`.

```tsx
import {
  AgentStateProvider,
  ToolCallStream,
  useAgentStream,
  useToolCall,
} from "@kibadist/agentui-react";

function App({ url, sessionId }: { url: string; sessionId: string }) {
  const { store } = useAgentStream({ url, sessionId });
  return (
    <AgentStateProvider store={store}>
      <ToolCallStream
        render={(call) => (
          <div data-status={call.status}>
            <code>{call.name}</code>
            {call.status === "pending" && <Spinner />}
            {call.status === "ok" && <ResultPreview result={call.result} />}
            {call.status === "error" && <ErrorBadge error={call.error} />}
          </div>
        )}
      />
    </AgentStateProvider>
  );
}

// Or subscribe to one specific call:
function ToolStatusPill({ id }: { id: string }) {
  const call = useToolCall(id);
  if (!call) return null;
  return <span>{call.name} · {call.status}</span>;
}
```

`call.argsRaw` holds the accumulated JSON text from `tool.args-delta` events; `call.args` is the best-effort `JSON.parse` of that buffer (undefined while args are still streaming).

### Reasoning streams

Stream-LLM chain-of-thought ("reasoning" or "thinking") has its own state slice and two selector hooks. Wire events: `reasoning.start`, `reasoning.delta`, `reasoning.end`.

```tsx
import {
  AgentStateProvider,
  useAgentStream,
  useLatestReasoning,
} from "@kibadist/agentui-react";

function ThinkingPanel() {
  const seg = useLatestReasoning();
  if (!seg) return null;
  return (
    <details open={seg.status === "streaming"}>
      <summary>{seg.status === "streaming" ? "Thinking…" : "Thought"}</summary>
      <pre>{seg.text}</pre>
    </details>
  );
}

function App({ url, sessionId }: { url: string; sessionId: string }) {
  const { store } = useAgentStream({ url, sessionId });
  return (
    <AgentStateProvider store={store}>
      <ThinkingPanel />
    </AgentStateProvider>
  );
}
```

For multi-segment rendering, use `useReasoning()` which returns the full ordered list. Each segment also carries an optional `turnId` (also captured on `ToolCall` from `tool.start`) — grouping selectors that join nodes/tool calls/reasoning by turn are deferred to v0.6.

### Optimistic updates

Apply local patches before the server confirms, then drop the patch on `optimistic.confirm` or revert on `optimistic.rollback`. Events flow in both directions: the host dispatches `apply` to overlay an entity's UI, and the server emits `confirm`/`rollback` once it processes the action.

```tsx
import {
  AgentStateProvider,
  useAgentStream,
  useOptimistic,
} from "@kibadist/agentui-react";

function QuoteStatusPill({ quoteId, canonical }: { quoteId: string; canonical: { status: string } }) {
  const optimistic = useOptimistic(`quote:${quoteId}`);
  const status = (optimistic?.status as string) ?? canonical.status;
  return <span data-status={status}>{status}</span>;
}

function ConfirmButton({ quoteId, sessionId }: { quoteId: string; sessionId: string }) {
  const { dispatch } = useAgentStream({ url: "/api/agent", sessionId });
  return (
    <button
      onClick={async () => {
        const originId = crypto.randomUUID();
        dispatch({
          v: 1,
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          sessionId,
          op: "optimistic.apply",
          entityKey: `quote:${quoteId}`,
          patch: { status: "confirmed" },
          originId,
          ttlMs: 5000,
        });
        // Then fire your real action; on success the server emits
        // optimistic.confirm; on failure it emits optimistic.rollback.
      }}
    >
      Confirm
    </button>
  );
}
```

`confirm` and `rollback` both remove the entry — the semantic difference is host-side intent (telemetry, success/error animation). The library does **not** start TTL timers; if you want client-side expiry, watch `useOptimisticAll()` from a `useEffect` and dispatch `optimistic.rollback` when an entry's `expiresAt` passes.

### Quick start with `<AgentRoot>`

For new apps, mount `<AgentRoot>` at the top of your tree. It handles session creation, conversation resume, and history rehydration in one place — and provides all the selector-hook context children need.

```tsx
import {
  AgentRoot,
  useAgentSession,
  useAgentHistory,
  useAgentNodes,
} from "@kibadist/agentui-react";

export function App() {
  return (
    <AgentRoot endpoint="/api/agent">
      <Chat />
    </AgentRoot>
  );
}

function Chat() {
  const { status, conversationId, reset } = useAgentSession();
  const { messages } = useAgentHistory();
  const nodes = useAgentNodes();

  if (status === "connecting") return <div>Connecting…</div>;
  if (status === "error") return <button onClick={() => reset()}>Reconnect</button>;

  return (
    <div>
      <ul>{messages.map((m, i) => <li key={i}>{m.role}: {m.text}</li>)}</ul>
      <div>{nodes.map((n) => /* render via registry */ null)}</div>
    </div>
  );
}
```

`<AgentRoot>` reads/writes `conversationId` via `localStorage` by default. For React Native, pass `storage={asyncStorageAdapter}` (host-defined wrapper around AsyncStorage that implements the `SessionStorageAdapter` interface). For auth wrappers, pass a custom `fetch={authedFetch}`.

The component expects three endpoints (relative to `endpoint`):
- `POST /session` — accepts optional `?conversationId=` to resume; returns `{ sessionId }`.
- `GET /stream?sessionId=...` — SSE stream emitting validated wire events.
- `GET /history?sessionId=...` — returns `{ messages: HistoryMessage[] }`. 404 is treated as "no history yet" and not an error.

**Multiple agents in one app.** Nest `<AgentRoot id="...">` to run two or more agents side-by-side:

```tsx
<AgentRoot id="chat" endpoint="/api/chat">
  <AgentRoot id="planner" endpoint="/api/planner">
    <App />
  </AgentRoot>
</AgentRoot>
```

All hooks accept an optional `id` argument to target a specific agent: `useAgentSession('chat')`, `useAgentNodes('planner')`, `useToolCalls('chat')`, and so on. Without an id, hooks resolve to the nearest `<AgentRoot>` ancestor (the current single-agent behavior, unchanged).

### LLM adapters: provider stream → wire events

`@kibadist/agentui-llm` ships three async-generator adapters that turn a provider's native streaming response into AgentUI wire events. Drop them into your SSE handler to skip the manual state-tracking:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { fromAnthropic } from "@kibadist/agentui-llm";

const anthropic = new Anthropic();
const stream = anthropic.messages.stream({
  model: "claude-sonnet-4-5",
  messages: [{ role: "user", content: userMessage }],
});

for await (const event of fromAnthropic(stream, { sessionId })) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
```

`fromOpenAI` and `fromGemini` follow the same shape. Each adapter maps:

- **Text** → `ui.append` (first delta creates a `text-block` node) + `ui.replace` for subsequent deltas.
- **Tool calls** → `tool.start` + `tool.args-delta` (host executes the tool and emits `tool.result` itself).
- **Reasoning** (Anthropic extended thinking only) → `reasoning.start` / `.delta` / `.end`.
- **Stream errors** → `ui.toast` with `level: "error"`.

Each provider's SDK is a *peer-dependency* of `@kibadist/agentui-llm` — install only the ones you use.

### DevTools panel: time-travel state inspector

The `@kibadist/agentui-react/devtools` subpath ships a floating debug panel:

```tsx
"use client";
import { AgentRoot } from "@kibadist/agentui-react";
import { AgentDevTools } from "@kibadist/agentui-react/devtools";

export default function Page() {
  return (
    <AgentRoot endpoint="/api/agent">
      <YourApp />
      <AgentDevTools />
    </AgentRoot>
  );
}
```

Defaults to enabled in non-production. For production opt-in, set `NEXT_PUBLIC_AGENTUI_DEVTOOLS=1` or pass `<AgentDevTools enabled />`. Because the panel lives at a separate subpath, apps that never `import "@kibadist/agentui-react/devtools"` get zero bytes of DevTools code in their production bundle.

The panel shows:

- **Event log** — every wire event with one-line summary, filterable by category (`ui`/`tool`/`reasoning`/`optimistic`/`session`) and searchable.
- **State tree** — the `AgentState` (nodes, toolCalls, reasoning, optimistic, toasts, byKey index) at the selected scrub position.
- **Scrubber** — slide back to any past event to see the state at that point. Time-travel only affects the panel — the host app keeps rendering live state.
- **Latency** — mean and p99 dispatch time over the last 100 events.

### CLI generator

Scaffold a typed AgentUI component in one command:

```bash
npx @kibadist/agentui new-node QuoteCard
```

Creates `quote-card.tsx`, `quote-card.schema.ts`, and `quote-card.test.tsx` (plus `quote-card.stories.tsx` when Storybook is detected), and inserts a registry entry between the marker comments.

Optional config at `agentui.config.json`:

```json
{
  "registry": "./components/registry.ts",
  "componentsDir": "./components"
}
```

One-time setup in your registry file:

```ts
// agentui:registry-imports-start
// agentui:registry-imports-end

export const registry = createRegistry({
  // agentui:registry-entries-start
  // agentui:registry-entries-end
});
```

### Schema-first nodes

Define a node's type, schema, component, and capability requirements in one call. The component's props are inferred from the Zod schema; emit-time validation is automatic.

```ts
import { z } from "zod";
import { defineNode, createRegistry } from "@kibadist/agentui-react";

const QuoteCardNode = defineNode({
  type: "quote-card",
  schema: z.object({
    quoteId: z.string(),
    total: z.number(),
  }),
  component: QuoteCard,
  requires: ["quotes.read"],
});

export const registry = createRegistry([QuoteCardNode]);

// Server side:
emit({ op: "ui.append", node: QuoteCardNode.build({
  key: "q-1",
  props: { quoteId: "Q-1", total: 1200 },
})});
```

The legacy object form `createRegistry({ "type": { component, propsSchema } })` continues to work.

### Stream resilience

Opt-in retry, backpressure, and auth-aware reconnect:

```ts
const { state, status } = useAgentStream({
  url, sessionId,
  retry: { maxAttempts: 5, initialDelayMs: 500, maxDelayMs: 30_000, jitter: "full" },
  buffer: { max: 1000, onOverflow: "drop-oldest" },
  auth: {
    getToken: () => fetchToken(),
    onUnauthorized: () => refreshSession(),
  },
});
```

`status` widens to `"idle" | "connecting" | "open" | "reauthenticating" | "reconnecting" | "closed" | "error"`. With no configs, defaults preserve previous behavior (infinite retry, unbounded buffer, no auth header).

Server-side: include an `id:` line on each event so `Last-Event-ID` reconnects can resume; return HTTP 401 to trigger `auth.onUnauthorized` + `auth.getToken`.

### Memory caps + metrics

Bound per-slice memory and observe runtime behavior:

```ts
<AgentRoot
  endpoint="..."
  caps={{
    maxNodes: 5000,
    maxToolCalls: 500,
    onEvict: (slice, evicted) => console.log(`evicted ${evicted.length} from ${slice}`),
  }}
  onMetric={(m) => sink.record(m)}
  tags={{ env: "prod" }}
>
  …
</AgentRoot>
```

Emitted metrics (all timings in ms):

| Name | Kind |
|---|---|
| `agentui.session.create_ms` | timing |
| `agentui.stream.connect_ms` | timing |
| `agentui.stream.first_event_ms` | timing |
| `agentui.stream.reconnect_attempts` | counter |
| `agentui.event.parse_ms` | timing |
| `agentui.event.dispatch_ms` | timing |
| `agentui.event.parse_error_count` | counter |

`sessionId` tags are FNV-1a hashed; raw UUIDs never leave the library.

### Testing helpers

`@kibadist/agentui-react/testing` ships drop-in mocks for vitest setups:

```tsx
import { createMockAgentStream } from "@kibadist/agentui-react/testing";
import { AgentStateProvider, useAgentNodes } from "@kibadist/agentui-react";

const mock = createMockAgentStream();

render(
  <AgentStateProvider store={mock.store}>
    <YourComponent />     {/* anywhere inside: useAgentNodes(), etc. */}
  </AgentStateProvider>,
);

act(() => {
  mock.push({ v: 1, op: "ui.append", node: { key: "a", type: "card", props: {} }, id: "e1", ts: "...", sessionId: "s" });
  mock.setStatus("open");
});

expect(mock.state.nodes).toHaveLength(1);
expect(mock.history).toHaveLength(1);
```

Also exposes `pushEvent(state, event)` and `replayConversation(events)` for pure reducer-level tests, and `createTestRegistry(map)` (a Registry that renders `<span data-testid="test-marker-{type}">` for unregistered types).

### Dropping the protocol direct dep

Wire-event types (`UIEvent`, `UIAppendEvent`, etc.) are re-exported from `@kibadist/agentui-react` as of 0.4.0. Consumers that previously dual-depended on `@kibadist/agentui-protocol` just to type `onEvent` can drop it:

```diff
- import type { UIEvent } from "@kibadist/agentui-protocol";
+ import type { UIEvent } from "@kibadist/agentui-react";
```

---

## Example Prompts

Try these once you have the dev server running:

```
Show me a summary of recent sales
```
→ Renders a `stat-card` grid + `data-table`

```
Compare pricing plans for a SaaS product
```
→ Renders a structured comparison `data-table`

```
Create a project task board with backlog, in progress, and done columns
```
→ Renders a `task-board` with draggable cards

```
Show system health status for production servers
```
→ Renders `stat-card` components with live-style indicators

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9 (`corepack enable` to auto-install)

### Install & Run

```bash
# Clone and install
git clone https://github.com/kibadist/agentui
cd agentui
pnpm install

# Build all packages
pnpm build

# Add your API key (Anthropic, OpenAI, DeepSeek, or Google — all supported)
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" > examples/nest-api/.env
echo "PORT=3001" >> examples/nest-api/.env

# Run backend (:3001) + frontend (:3000) together
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
# Or run individually
pnpm dev:api   # NestJS backend on :3001
pnpm dev:app   # Next.js frontend on :3000
```

---

## Packages

| Package | npm | Purpose |
|---------|-----|---------|
| [`@kibadist/agentui-protocol`](https://www.npmjs.com/package/@kibadist/agentui-protocol) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-protocol)](https://www.npmjs.com/package/@kibadist/agentui-protocol) | TypeScript types for the wire protocol (`UIEvent`, `ActionEvent`, `UINode`) |
| [`@kibadist/agentui-validate`](https://www.npmjs.com/package/@kibadist/agentui-validate) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-validate)](https://www.npmjs.com/package/@kibadist/agentui-validate) | Zod schemas + parsers (`parseUIEvent`, `safeParseUIEvent`) |
| [`@kibadist/agentui-react`](https://www.npmjs.com/package/@kibadist/agentui-react) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-react)](https://www.npmjs.com/package/@kibadist/agentui-react) | Registry, renderer, SSE hook, action context |
| [`@kibadist/agentui-nest`](https://www.npmjs.com/package/@kibadist/agentui-nest) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-nest)](https://www.npmjs.com/package/@kibadist/agentui-nest) | Session event bus + controller factory for NestJS |
| [`@kibadist/agentui-ai`](https://www.npmjs.com/package/@kibadist/agentui-ai) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-ai)](https://www.npmjs.com/package/@kibadist/agentui-ai) | Provider-agnostic adapter via Vercel AI SDK (OpenAI, Anthropic, Google, DeepSeek) |
| [`@kibadist/agentui-llm`](https://www.npmjs.com/package/@kibadist/agentui-llm) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-llm)](https://www.npmjs.com/package/@kibadist/agentui-llm) | Provider-native LLM stream adapters (Anthropic, OpenAI, Gemini) |
| [`@kibadist/agentui-next`](https://www.npmjs.com/package/@kibadist/agentui-next) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-next)](https://www.npmjs.com/package/@kibadist/agentui-next) | SSE proxy + action proxy helpers for Next.js App Router |

---

```mermaid
flowchart BT
  protocol["📦 protocol\n(zero deps — pure types)"]
  validate["📦 validate\n(+zod)"]
  react["📦 react\n(+react)"]
  nest["📦 nest\n(+@nestjs/common, rxjs)"]
  ai["📦 ai\n(+Vercel AI SDK)"]
  next["📦 next\n(no runtime deps)"]

  validate --> protocol
  react --> protocol
  nest --> protocol
  ai --> protocol
  next --> protocol
```

---

## Use Cases

AgentUI is a good fit when you need an LLM to **compose structured UI** rather than just stream text:

- **Internal dashboards** — agent queries your DB and renders tables, charts, stat cards
- **AI copilots** — agent renders contextual UI panels alongside a chat interface
- **Agentic workflows** — agent builds task boards, checklists, or forms that users interact with
- **CRM / ops tools** — agent surfaces customer data or job status as rich UI components
- **Dev tools** — agent renders structured output (test results, diffs, API responses) in a readable format

---

## Roadmap

- [ ] Streaming partial renders (render component as props stream in)
- [ ] Built-in component library (zero-config starter components)
- [ ] Vue adapter (`@kibadist/agentui-vue`)
- [ ] `ui.update` patch operation (partial prop update without full replace)
- [ ] Persistence layer (replay UI state across sessions)

---

## Contributing

Issues and PRs welcome. The repo is a pnpm monorepo — see each package's `README` for package-specific docs.

```bash
pnpm build        # build all packages
pnpm test         # run tests across workspace
pnpm lint         # lint all packages
```

---

## License

MIT © [Maksym Ivashchenko](https://github.com/kibadist)
