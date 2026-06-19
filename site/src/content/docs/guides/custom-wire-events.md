---
title: "Custom wire events"
description: "Reserve project-local wire ops (e.g. `host.*`, `myapp.*`) for events the library should pass through to your `subscribeAction` listeners without going through the protocol reducer."
---

The protocol reserves a closed namespace of ops — `ui.*`, `tool.*`, `reasoning.*`, `optimistic.*`, `session.*`, `workflow.*`. Anything outside that set is a **custom wire event**: a project-local op your server can emit and your client can observe via `AgentStore.subscribeAction`, without the reducer touching it.

## When to use it

You have a UI signal that doesn't fit the protocol model:

- A `host.panelPatch` event that drives `form.setValue` on the active side panel
- A `myapp.refresh` event that re-fetches a non-AgentUI list elsewhere on the page
- A `analytics.markFunnelStep` event your tracking code subscribes to

The reducer no-ops the event (state unchanged). The store still notifies every `subscribeAction` listener — that's where your project handles it.

## Schema contract

A custom wire event must satisfy the base envelope:

```ts
{
  v: 1,
  id: string,
  ts: string,           // ISO-8601
  sessionId: string,
  op: string,           // any value that is NOT a reserved protocol op
  // …arbitrary additional fields (you own the contract)
}
```

Reservation is **prefix-based**: any op starting with `ui.`, `tool.`, `reasoning.`, `optimistic.`, `session.`, or `workflow.` belongs to the protocol. Custom events must use a different prefix.

```ts
import { RESERVED_PROTOCOL_OP_PREFIXES } from "@kibadist/agentui-validate";

RESERVED_PROTOCOL_OP_PREFIXES; // → ["ui.", "tool.", "reasoning.", "optimistic.", "session.", "workflow."]
```

The schema **rejects** custom events that use a reserved prefix. This keeps malformed protocol events (e.g. a `ui.append` missing `node`) failing closed — they don't slip through the passthrough variant. Prefix reservation also future-proofs the namespace: if v1.x adds new ops to an existing prefix (`ui.dialog`, `tool.retry`, etc.) hosts that already shipped a custom op there would suddenly start matching the closed variant and fail validation. With prefix reservation, those collisions are rejected upfront.

## Emitting from the server

Any transport that emits valid `AgentWireEvent` JSON also accepts custom events:

```ts
// In your NestJS or Vercel AI tool handler:
session.publish({
  v: 1,
  id: crypto.randomUUID(),
  ts: new Date().toISOString(),
  sessionId,
  op: "host.panelPatch",
  target: "client-form",
  fields: { name: "John Smith", vehicle: "BMW X5" },
});
```

Validation happens at the same `safeParseAgentEvent` gate as protocol events. Malformed custom events (e.g. missing `sessionId`) are dropped via `onInvalidEvent` exactly like malformed protocol events.

## Observing from the client

Subscribe to the store's action stream. The `subscribeAction` listener fires on every dispatch, including no-ops — which is the whole point: the reducer no-ops your custom op, but you still observe it.

```ts
import { isCustomWireEvent } from "@kibadist/agentui-validate";

const unsubscribe = store.subscribeAction((action) => {
  if (!isCustomWireEvent(action)) return;
  // `action` is narrowed to CustomWireEvent here — no cast needed.

  if (action.op === "host.panelPatch") {
    const target = action.target as string;
    const fields = action.fields as Record<string, unknown>;
    formBridge.setValues(target, fields);
  }
});
```

`isCustomWireEvent` is a type predicate, so TypeScript narrows `action` to `CustomWireEvent` inside the guarded branch. Individual payload fields are typed `unknown` (because the consumer owns the contract) — narrow them with a cast or a runtime check before use.

### Typing your own ops

For richer typing, extend `CustomWireEvent` with the shape you control, and narrow with a small helper:

```ts
import type { CustomWireEvent } from "@kibadist/agentui-protocol";

interface HostPanelPatch extends CustomWireEvent {
  op: "host.panelPatch";
  target: string;
  fields: Record<string, unknown>;
}

function isHostPanelPatch(e: CustomWireEvent): e is HostPanelPatch {
  return e.op === "host.panelPatch";
}

store.subscribeAction((action) => {
  if (!isCustomWireEvent(action)) return;
  if (isHostPanelPatch(action)) {
    formBridge.setValues(action.target, action.fields);
  }
});
```

`CustomWireEvent` is intentionally NOT a member of the `AgentWireEvent` / `AgentAction` union — adding an open `op: string` variant would collapse discriminated-union narrowing inside the library (e.g. `event.op === "ui.append"` would no longer narrow to `UIAppendEvent` cleanly). The runtime gladly passes custom events through; `isCustomWireEvent` bridges the type-system seam.

## Recommended op naming

Pick a stable, unambiguous prefix:

| Prefix      | When                                                       |
|-------------|------------------------------------------------------------|
| `host.*`    | Signals from your server to the host application shell     |
| `myapp.*`   | Project-internal events (use your app name)                |
| `<team>.*`  | Cross-team ownership in a monorepo                         |

Avoid bare names (`refresh`, `update`) — they read like protocol ops and risk collisions if the library grows new namespaces in the future. Two-segment dot-namespaced names are durable.

## Failure modes

- **Custom event arrived but listener didn't fire.** Check that the event passes the base envelope (`v: 1`, `id`, `ts`, `sessionId`). If not, the transport drops it via `onInvalidEvent` (which `<AgentRoot>` does not surface — see [stream resilience](../stream-resilience/) for the parse-error counter).
- **`event.op === "host.foo"` doesn't narrow in TypeScript.** That's expected — TS doesn't know about your custom op shape. Cast via `as unknown as YourCustomEvent` after the runtime check.
- **Schema validation rejects a custom event.** Almost always the base envelope: missing `sessionId`, wrong `v`, empty `op` string. The validation error message includes the path.

## See also

- [State selectors](../state-selectors/) — the broader hook surface that `subscribeAction` lives on
- [Wire protocol](../../wire-protocol/) — the reserved ops your custom names must avoid
- [Stream resilience](../stream-resilience/) — how invalid events are surfaced
