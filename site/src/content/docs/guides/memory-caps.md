---
title: "Memory caps + metrics"
description: "Bound per-slice memory and observe runtime behavior."
---

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

## Related

- [DevTools](../devtools/)
- [Testing](../testing/)
