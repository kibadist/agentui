---
title: "Reasoning streams"
description: "Stream-LLM chain-of-thought (\"reasoning\" or \"thinking\") has its own state slice and two selector hooks. Wire events: `reasoning.start`, `reasoning.delta`, `reasoning.end`."
---

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

## Related

- [Tool calls](../tool-calls/)
