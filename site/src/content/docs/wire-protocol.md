---
title: "Wire Protocol"
description: "The complete set of typed events agents emit and clients render. Validated server-side via Zod; rendered through a developer-controlled registry."
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

## JSON Patch payloads for `ui.replace`

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

## Streaming partial-JSON

LLM tool calls stream their JSON args incrementally. `parsePartialJson` returns a `Partial<T>` after each delta, repairing truncated input:

````ts
import { parsePartialJson, streamingJsonParse } from "@kibadist/agentui-react";

parsePartialJson<{ q: string; tags: string[] }>('{"q":"foo","tags":[1,2');
// → { q: "foo", tags: [1, 2] }

for await (const partial of streamingJsonParse<{ q: string }>(stream)) {
  // partial.q updates progressively
}
````

The reducer uses `parsePartialJson` internally so `state.toolCalls.get(id).args` updates after every `tool.args-delta` event, not only at completion.

## Capabilities handshake

Servers can declare available node types, accepted actions, and the session's effective permissions as the first event of a stream:

````ts
// server-side
{
  op: "session.init",
  capabilities: {
    nodeTypes: ["Card", "Quote", "ClientCard"],
    actions: ["purchase.confirm", "quote.send"],
    permissions: ["quotes.write", "clients.read"],
  }
}
````

Consumers read the declaration via `useCapabilities()`:

````ts
import { useCapabilities } from "@kibadist/agentui-react";

function ConfirmButton() {
  const caps = useCapabilities();
  if (!caps.canAct("purchase.confirm")) return null;
  return <button>Confirm</button>;
}
````

`AgentRenderer` consults `ComponentSpec.requires` against `permissions`. If the session lacks any required permission, the node hides silently — or renders a host-supplied fallback:

````ts
<AgentRenderer
  state={state}
  registry={registry}
  permissionFallback={(node, missing) => (
    <div>You need {missing.join(", ")} to view this.</div>
  )}
/>
````

Servers that don't emit `session.init` see no behavior change — gating only activates after the handshake.

## Resetting a conversation

```tsx
const { state, reset } = useAgentStream({ url, sessionId });
useEffect(() => { reset(); }, [sessionId, reset]); // fresh state on session change
```

Migrating from a hand-rolled `agentNodeOffset` workaround: delete the offset bookkeeping and call `reset()` instead — the reducer now hands back fresh `nodes` / `byKey` references on every reset, so there's nothing to subtract from.

## Dropping the protocol direct dep

Wire-event types (`UIEvent`, `UIAppendEvent`, etc.) are re-exported from `@kibadist/agentui-react` as of 0.4.0. Consumers that previously dual-depended on `@kibadist/agentui-protocol` just to type `onEvent` can drop it:

```diff
- import type { UIEvent } from "@kibadist/agentui-protocol";
+ import type { UIEvent } from "@kibadist/agentui-react";
```

## Related

- [Concepts](../concepts/)
- [JSON Schema export](../guides/json-schema-export/)
