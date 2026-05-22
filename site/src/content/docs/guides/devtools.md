---
title: "DevTools panel"
description: "The `@kibadist/agentui-react/devtools` subpath ships a floating debug panel:"
---

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

## Related

- [Testing](./testing.md)
