# @kibadist/agentui-react

React components, hooks, and state management for the AgentUI protocol.

## Install

```bash
npm install @kibadist/agentui-react
```

**Peer dependency:** `react` ^18.0.0 || ^19.0.0

## Quick start

### 1. Define a component registry

```tsx
import { createRegistry } from "@kibadist/agentui-react";
import { TextBlock } from "./text-block";
import { InfoCard } from "./info-card";

export const registry = createRegistry({
  "text-block": { component: TextBlock },
  "info-card":  { component: InfoCard },
});
```

### 2. Connect and render

```tsx
import {
  AgentRuntimeProvider,
  AgentRenderer,
} from "@kibadist/agentui-react";
import { registry } from "./registry";

function App({ sessionId }: { sessionId: string }) {
  return (
    <AgentRuntimeProvider
      url={`/api/agent/${sessionId}/stream`}
      sessionId={sessionId}
    >
      {({ state, status }) => (
        <>
          <p>Status: {status}</p>
          <AgentRenderer state={state} registry={registry} />
        </>
      )}
    </AgentRuntimeProvider>
  );
}
```

### 3. Dispatch actions from components

```tsx
import { useAgentAction } from "@kibadist/agentui-react";

function MyButton({ actionName }: { actionName: string }) {
  const send = useAgentAction();

  return (
    <button onClick={() => send({
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId: "...",
      kind: "action",
      type: "action.submit",
      name: actionName,
      payload: {},
    })}>
      Click me
    </button>
  );
}
```

## Manual setup (without AgentRuntimeProvider)

For more control, use the individual hooks and providers:

```tsx
import {
  useAgentStream,
  AgentActionProvider,
  AgentRenderer,
} from "@kibadist/agentui-react";

function AgentView({ sessionId }: { sessionId: string }) {
  const { state, status } = useAgentStream({
    url: `/api/agent/${sessionId}/stream`,
    sessionId,
  });

  const sender = useCallback(async (action) => {
    await fetch(`/api/agent/${sessionId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
  }, [sessionId]);

  return (
    <AgentActionProvider sender={sender}>
      <AgentRenderer state={state} registry={registry} />
    </AgentActionProvider>
  );
}
```

## Slot filtering

Render different parts of the UI in different layout regions:

```tsx
<AgentRenderer state={state} registry={registry} slot="main" />
<AgentRenderer state={state} registry={registry} slot="sidebar" />
```

## Exports

| Export | Kind | Description |
|---|---|---|
| `createRegistry` | function | Create a component registry from a map |
| `AgentRenderer` | component | Renders nodes from agent state using the registry |
| `useAgentStream` | hook | SSE connection to the agent, returns `{ state, status, close }` |
| `AgentActionProvider` | component | Provides action sender via context |
| `useAgentAction` | hook | Access the action sender from context |
| `AgentRuntimeProvider` | component | Composite provider (stream + actions) with render prop |
| `agentReducer` | function | Processes UIEvents into AgentState |
| `initialAgentState` | constant | Default empty agent state |
| `AgentState` | type | State shape: nodes, toasts, navigation |
| `StreamStatus` | type | `"idle" \| "connecting" \| "open" \| "closed" \| "error"` |
| `ActionSender` | type | `(action: ActionEvent) => Promise<void>` |
| `Registry` | type | Registry interface with `get`, `has`, `types` methods |

## License

MIT
