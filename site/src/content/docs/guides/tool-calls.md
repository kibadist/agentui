---
title: "Tool calls"
description: "Stream-LLM tool calls have a built-in state slice and a headless renderer. Wire events: `tool.start`, `tool.args-delta`, `tool.result`, `tool.cancel`."
---

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

## Related

- [Reasoning](../reasoning/)
- [Optimistic updates](../optimistic/)
