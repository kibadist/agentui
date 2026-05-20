# `<AgentRoot>`

Top-level provider that wires session, history, and selector-hook context in one place.

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

## Multiple agents in one app

Nest `<AgentRoot id="...">` to run two or more agents side-by-side:

```tsx
<AgentRoot id="chat" endpoint="/api/chat">
  <AgentRoot id="planner" endpoint="/api/planner">
    <App />
  </AgentRoot>
</AgentRoot>
```

All hooks accept an optional `id` argument to target a specific agent: `useAgentSession('chat')`, `useAgentNodes('planner')`, `useToolCalls('chat')`, and so on. Without an id, hooks resolve to the nearest `<AgentRoot>` ancestor (the current single-agent behavior, unchanged).

## Related

- [State selectors](./state-selectors.md)
- [Renderer](./renderer.md)
- [Server companion (Node)](./server-node.md)
