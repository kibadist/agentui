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
