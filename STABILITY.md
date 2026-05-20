# Stability promise

This document describes what is covered by semantic versioning in `@kibadist/agentui-*` and which extension points are stable for third-party use.

The library is currently on the `0.x` line. While on `0.x`:
- Minor versions (`0.N → 0.N+1`) **may** introduce breaking changes. Each minor release documents migrations in `CHANGELOG.md`.
- Patch versions (`0.N.M → 0.N.M+1`) do not introduce breaking changes.

After v1.0:
- Major versions (`N → N+1`) signal breaking changes. Migrations documented in a `MIGRATION-<version>.md` file at the repo root.
- Minor versions add backwards-compatible features.
- Patch versions are bug fixes only.

## What's stable

The following surface is the public contract. Anything exported here will not change shape in a backwards-incompatible way without a major version bump (post-v1.0) or a documented migration (pre-v1.0).

### Wire protocol

The full event protocol declared in `@kibadist/agentui-protocol`:

- `UIEvent` union (`ui.append`, `ui.replace`, `ui.remove`, `ui.toast`, `ui.navigate`, `ui.reset`).
- `ToolEvent` union (`tool.start`, `tool.args-delta`, `tool.result`, `tool.cancel`).
- `ReasoningEvent` union (`reasoning.start`, `reasoning.delta`, `reasoning.end`).
- `OptimisticEvent` union (`optimistic.apply`, `optimistic.confirm`, `optimistic.rollback`).
- `SessionMetaEvent`, `SessionInitEvent`.
- `WorkflowEvent` union (`workflow.start`, `workflow.advance`, `workflow.complete`, `workflow.cancel`).
- `ActionEvent` union (`action.submit`, `action.select`, `action.approve`, `action`).
- `BaseEvent` shape: `{ v, id, ts, sessionId, traceId? }`.
- `UINode` shape: `{ key, type, props, slot?, children?, meta? }`.

The JSON Schema files in `@kibadist/agentui-validate/schema/*.json` are normative — non-TypeScript consumers can validate against those.

### Extension points

Stable interfaces designed for third-party implementations:

| Interface | Package | What you implement |
|---|---|---|
| `Registry` | `@kibadist/agentui-react` | Component registry; build via `createRegistry({ "type": { component, requires?, propsSchema? } })` or `defineNode({ type, schema, component })`. |
| `ComponentSpec` | `@kibadist/agentui-react` | Per-type component declaration: `{ component, requires?, propsSchema? }`. |
| `SessionStorageAdapter` | `@kibadist/agentui-react` | Persistence for session/conversation ids. Ship in `<AgentRoot storage={...} />`. The built-in `localStorageAdapter` is a reference impl. |
| `ConversationStorage` | `@kibadist/agentui-node` | Conversation event persistence. Implement `append(sessionId, event)` + `history(sessionId, opts)`. Plug into `new Conversation({ storage })`. The built-in `MemoryConversationStorage` is a reference impl. |
| `StreamTransport` | `@kibadist/agentui-react` (planned) | Custom transport for `useAgentStream`. Today only the built-in `EventSource`/`fetch` transport is supported; the public hook for custom transports is on the roadmap. |

### Public hooks (`@kibadist/agentui-react`)

- `useAgentStream(options)`
- `useAgentSelector(selector)`
- `useAgentNodes()`, `useAgentToasts()`, `useAgentNavigate()`
- `useToolCalls()`, `useToolCall(id)`
- `useReasoning()`, `useLatestReasoning()`
- `useOptimistic(entityKey)`, `useOptimisticAll()`
- `useWorkflow(id)`
- `useCapabilities()`
- `useAgentSession()`, `useAgentHistory()`
- `useAgentAction()`

Their option types, return shapes, and referential-stability guarantees are part of the contract.

### Top-level components

- `<AgentRoot>`, `<AgentStateProvider>`, `<AgentActionProvider>`, `<AgentRuntimeProvider>`, `<SessionProvider>`, `<AgentRenderer>`, `<WorkflowStepper>`, `<ToolCallStream>`.

### Server primitives (`@kibadist/agentui-node`)

- `createAgentStream`, `createAgentReadable`
- `AgentStream`, `AgentStreamOptions`, `EmitInput` types
- `Conversation`, `ConversationStorage`, `StoredEvent`
- `MemoryConversationStorage`
- `emitTextStream`, `emitToolCall` helpers

## What's experimental

The following may change without a migration path during 0.x. Pinned to a minor version, but no SLA.

- `@kibadist/agentui-react/devtools` exports (`AgentDevTools`) — UI may shift between minors as the panel evolves.
- `AgentRoot` namespacing internals (`AgentRootRegistry`, `resolveAgentRoot`, `useAgentRootRegistryEntry`) — exported for hosts that need them today, but the contract is not frozen.
- `metrics` types (`Metric`, `MetricEmitter`) — observability shape is evolving; we will stabilize it after DET-150's caps + metrics work has at least one external consumer.

## What's deprecated

(Post-v1.0 this section lists items that will be removed in the next major. Today it is empty.)

## How to extend

### Custom registry

```ts
import { createRegistry } from "@kibadist/agentui-react";

const registry = createRegistry({
  "purchase.checkout": {
    component: CheckoutPanel,
    requires: ["checkout.confirm"], // permissions gate via session.init
  },
});
```

Or via `defineNode` for end-to-end schema inference:

```ts
import { defineNode } from "@kibadist/agentui-react";
import { z } from "zod";

const Card = defineNode({
  type: "card",
  schema: z.object({ title: z.string(), body: z.string() }),
  component: ({ title, body }) => <article><h3>{title}</h3><p>{body}</p></article>,
});
```

### Custom session storage

```ts
import type { SessionStorageAdapter } from "@kibadist/agentui-react";

const cookieAdapter: SessionStorageAdapter = {
  load: async () => parseCookie("agentui-session"),
  save: async (data) => writeCookie("agentui-session", data),
  clear: async () => clearCookie("agentui-session"),
};

<AgentRoot endpoint="/api/agent" storage={cookieAdapter} />
```

### Custom conversation storage

```ts
import type { ConversationStorage, StoredEvent } from "@kibadist/agentui-node";

class PrismaConversationStorage implements ConversationStorage {
  async append(sessionId: string, event: StoredEvent) {
    await prisma.agentEvent.create({
      data: { sessionId, eventId: event.id, ts: event.ts, payload: event },
    });
  }
  async history(sessionId: string, opts) {
    const rows = await prisma.agentEvent.findMany({
      where: {
        sessionId,
        ...(opts?.before ? { ts: { lt: opts.before } } : {}),
      },
      orderBy: { ts: "asc" },
      take: opts?.limit,
    });
    return rows.map((r) => r.payload as StoredEvent);
  }
}
```

### Custom backend transport (without using a built-in SSE adapter)

Implement your own session + SSE endpoint hitting the same wire format. The `@kibadist/agentui-validate` package provides `safeParseUIEvent` / `safeParseActionEvent` for server-side validation. The JSON Schemas in `@kibadist/agentui-validate/schema/*.json` describe the same shapes for non-TS servers.

## Reporting stability concerns

If you find an undocumented surface that's load-bearing for your code and we change it, open an issue tagged `stability`. We treat that as a contract bug.
