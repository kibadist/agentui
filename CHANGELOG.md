# Changelog

All notable changes to `@kibadist/agentui-*` packages.

## 0.5.0

### Added — `@kibadist/agentui-protocol`

- **Tool-call wire events.** Four new server→client events: `tool.start`, `tool.args-delta`, `tool.result`, `tool.cancel`. New types: `ToolCallStartEvent`, `ToolArgsDeltaEvent`, `ToolCallResultEvent`, `ToolCallCancelEvent`, `ToolEvent` union, `ToolEventOp`, `AgentWireEvent` (= `UIEvent | ToolEvent`).
- **Reasoning/thinking wire events.** Three new server→client events: `reasoning.start`, `reasoning.delta`, `reasoning.end`. New types: `ReasoningStartEvent`, `ReasoningDeltaEvent`, `ReasoningEndEvent`, `ReasoningEvent` union, `ReasoningEventOp`. `AgentWireEvent` widens to `UIEvent | ToolEvent | ReasoningEvent`.
- **Optional `turnId: string`** on `tool.start`, `reasoning.start`, and `ui.append` events. Hosts that ignore it see no change; per-turn grouping selectors will ship in v0.6 if there's demand.
- **Optimistic wire events.** Three new events for optimistic UI patterns: `optimistic.apply` (entityKey + patch + originId + optional ttlMs), `optimistic.confirm` (originId), `optimistic.rollback` (originId). Server-emittable AND client-dispatchable. New types: `OptimisticApplyEvent`, `OptimisticConfirmEvent`, `OptimisticRollbackEvent`, `OptimisticEvent` union, `OptimisticEventOp`. `AgentWireEvent` widens to include them.
- **Session lifecycle wire event.** New `session.meta` event carrying `conversationId`. `<AgentRoot>` (below) persists this for resume. New type: `SessionMetaEvent`. `AgentWireEvent` widens to include it.

### Added — `@kibadist/agentui-validate`

- `toolEventSchema` and `agentWireEventSchema` (combined UI + tool discriminated union).
- `safeParseAgentEvent`, `parseAgentEvent`, `isAgentEvent` — parsers for the combined wire union. `safeParseUIEvent` stays UI-only for back-compat.
- `reasoningEventSchema` is exported. `agentWireEventSchema` widens to include the three reasoning event schemas plus optional `turnId` on `tool.start` and `ui.append` schemas.
- `optimisticEventSchema` is exported. `agentWireEventSchema` widens to include the three optimistic event schemas (16 total variants now).
- `sessionMetaSchema` is exported. `agentWireEventSchema` widens to 17 variants.

### Added — `@kibadist/agentui-react`

- **Tool-call state slice on `AgentState`:** `toolCalls: Map<string, ToolCall>` and `toolCallsOrder: string[]`. Reducer handles the four new event types; `__reset__` and `ui.reset` clear them. Late `tool.result` (after `tool.cancel` or for an unknown id) is a silent no-op.
- **Selector hooks:** `useToolCalls()` and `useToolCall(id)`. Re-render only when their slice changes — `useToolCall("t1")` stays stable when a `ui.toast` arrives.
- **`<ToolCallStream render={(call) => ...} />`** — headless renderer that maps over `state.toolCallsOrder`. Host supplies the visual.
- `useAgentStream` now parses tool events via `safeParseAgentEvent`. The hook's `onEvent` callback widens to `AgentWireEvent`; existing UI-only consumers are unaffected.
- **Reasoning state slice on `AgentState`:** `reasoning: Map<string, ReasoningSegment>` and `reasoningOrder: string[]`. Reducer handles the three new event types; `__reset__` and `ui.reset` clear them.
- **Selector hooks:** `useReasoning()` returns all segments in insertion order; `useLatestReasoning()` returns the most recently started segment (streaming or done).
- **`turnId` capture:** `ReasoningSegment.turnId` is set from `reasoning.start`. `ToolCall.turnId` is set from `tool.start`. The renderer does not yet thread `turnId` from `ui.append` into `UINode.meta` — consumers needing it read via `onEvent`.
- **Optimistic state slice on `AgentState`:** `optimistic: Map<string entityKey, OptimisticEntry>`. Reducer handles the three new event types; `__reset__` and `ui.reset` clear them. Last-write-wins on `entityKey`; confirm/rollback match by `originId` so the "apply A → apply B → confirm A" race resolves as a no-op.
- **Selector hooks:** `useOptimistic(entityKey)` returns the patch for one entity; `useOptimisticAll()` returns the full Map. The single-entity selector is reference-stable when unrelated entities change.
- **`useAgentStream().dispatch` widens to `AgentWireEvent`.** Consumers can now fire `optimistic.apply` (and any other wire event) from React code. Existing callers passing plain `UIEvent` continue to type-check unchanged. The library does NOT schedule TTL timers — hosts implement expiry via `useEffect` over `useOptimisticAll()` and dispatching `optimistic.rollback`. Documented pattern in README.
- **`<AgentRoot endpoint="...">`** — single mount-point that bundles session create/resume, conversationId persistence (pluggable `SessionStorageAdapter`), stream wiring, and action dispatching. Replaces ~80 lines of host plumbing.
- **`useAgentSession()`** — subscribe to session lifecycle (`sessionId`, `conversationId`, `status`, `error`, `create`, `resume`, `reset`, `close`). Must be used inside `<AgentRoot>`.
- **`useAgentHistory()`** — fetches `GET {endpoint}/history?sessionId={sessionId}` on session start. 404 resolves to an empty list (no error fired). `reload()` re-fetches.
- **`localStorageAdapter`** (default) and the `SessionStorageAdapter` interface (pluggable for React Native AsyncStorage). New `AgentError` type with discriminated `kind` (`session-create` / `session-resume` / `history-fetch` / `stream`).
- **Multi-agent namespacing.** `<AgentRoot id="...">` registers itself in an `AgentRootRegistry` context; nested `<AgentRoot>` instances form a linked list. All hooks gain an optional `id` parameter — `useAgentSession('chat')`, `useAgentNodes('planner')`, etc. — to scope lookups to a specific agent. Id-less calls keep current nearest-scope behavior (zero overhead). Duplicate ids in the same nested chain throw at mount.

### Behavior

- Servers that don't emit tool events are unaffected. `AgentState` gains two new fields with empty defaults; existing reads of `nodes`/`toasts`/`navigate` behave identically.

## 0.4.0

### Added — `@kibadist/agentui-react`

- `AgentRenderer` gains five additive props: `range`, `filter`, `hiddenTypes`, `errorFallback`, `nodeWrapper`. Composition order is `slot → range → filter → hiddenTypes`. All five default to no-op — callers that don't pass them see identical behavior to `0.3.x`.
  - Replaces hand-rolled `SlicedAgentRenderer` wrappers, per-node `<ErrorBoundary>` wrapping, and ad-hoc `hiddenTypes` filtering in consumer code.
- `AgentRendererProps` type is now exported from `@kibadist/agentui-react` for consumers composing on top of the renderer.
- **Granular state selectors.** New hooks: `useAgentNodes()`, `useAgentToasts()`, `useAgentNavigate()`, `useAgentSelector(selector, eq?)`. Consumers using these stop re-rendering on unrelated state changes (e.g., `useAgentNodes()` consumers don't re-render on `ui.toast` / `ui.navigate`).
- **`AgentStateProvider`** context + the `useAgentStream().store` field. Wire as `<AgentStateProvider store={stream.store}>` to enable selector hooks below it.
- **`createAgentStore()`** factory exported for tests and non-stream-driven hosts. Implements `{ getState, subscribe, send, reset }` — a minimal `Subscribable<AgentState>`.
- **Testing subpath** (`@kibadist/agentui-react/testing`). Ships `createMockAgentStream(initial?)` (hook + control surface: `push`, `dispatchInternal`, `setStatus`, `reset`, `state` getter, `history`), pure `pushEvent` / `replayConversation` reducer helpers, and `createTestRegistry` (a Registry that stubs missing types with marker components for assertions). No runtime cost — vitest stays a devDep.
- **Wire protocol event types** are now re-exported from `@kibadist/agentui-react`: `UIEvent`, `UINode`, `UIAppendEvent`, `UIReplaceEvent`, `UIRemoveEvent`, `UIToastEvent`, `UINavigateEvent`, `UIResetEvent`. Consumers that depended on `@kibadist/agentui-protocol` only to type `onEvent` callbacks can drop that direct dependency:

  ```diff
  - import type { UIEvent } from "@kibadist/agentui-protocol";
  + import type { UIEvent } from "@kibadist/agentui-react";
  ```
- **`"use client"` directives** added to every module that uses React hooks or contexts (renderer, runtime-provider, action-context, agent-state-context, selectors, use-agent-stream, testing/mock-agent-stream). Removes the need for consumer-side shim files in Next.js App Router projects.
- **JSDoc on every public export** — interfaces, types, factory functions, hooks, components. Renderer prop semantics, hook return shapes, and event-op narrowing each get inline docs.

### Behavior

- The internal error boundary only attaches when `errorFallback` is set — no reconciliation overhead for consumers who don't use it.
- `nodeWrapper` is the outermost layer per node; it stays mounted even when the inner component throws and is caught by `errorFallback` (lets `<AnimatePresence>`-style wrappers track keys cleanly).
- Per-node React keys are now placed on an invisible `React.Fragment` for consistency across all wrapper combinations. No DOM impact.
- **Minor:** when a node's type is missing from the registry and a `fallback` is provided, the renderer now returns the fallback content directly. Previously it wrapped the result in a `<span>`. The React key now lives on the outer Fragment, so reconciliation is unchanged — but any CSS or DOM-query that relied on the `<span>` wrapper around fallback output will need to be updated.
- `useAgentStream` is now backed internally by an `AgentStore` and `useSyncExternalStore`. The returned `state` field has identical shape and semantics to before; consumers reading `state` directly see no behavior change. Selector hooks are the recommended path for any component that doesn't need the full state object.

## 0.3.1

### Fixed

- **`@kibadist/agentui-*`** — Internal workspace deps now publish as `^0.3.1` ranges instead of pinned `0.3.1`, so consumers can dedupe across the family. (0.3.0 shipped with pinned ranges.)

### Added

- `sideEffects: false` on all 7 published packages — enables bundler tree-shaking.
- Test suite: Vitest with reducer, validate, and `useAgentStream` coverage. Includes the **interleave regression test** (`append → reset → append` yields one node) — the property the offset-workaround was approximating.

### Deprecated

- **`@kibadist/agentui-react`** — `initialAgentState` constant is now `@deprecated`. It's a single shared object whose `byKey` Map is reused across resets, which can alias state between sessions. Use `createInitialAgentState()` instead. The constant stays exported for v0.2.x back-compat.

## 0.3.0

### Added — `@kibadist/agentui-protocol`

- **`UIResetEvent`** (`op: "ui.reset"`) — wire event that clears all client-side UI state. Use for end-of-conversation, summarizer flush, or OOM rollback.

### Added — `@kibadist/agentui-validate`

- `uiResetSchema` in the discriminated union; `safeParseUIEvent` round-trips `ui.reset` events.

### Added — `@kibadist/agentui-react`

- **`useAgentStream().reset()`** — clears reducer state (nodes, toasts, navigate). The underlying `EventSource` stays open.
- **`useAgentStream().dispatch(event)`** — injects a `UIEvent` into the reducer without going through the wire. For optimistic updates, host-driven UI, and tests.
- **`createInitialAgentState()`** factory — returns a fresh `AgentState` with a new `Map` per call. Use instead of the deprecated `initialAgentState` constant.
- New exported types: `AgentAction`, `AgentResetAction`, `UseAgentStreamResult`.
- `agentReducer` signature widened to `(state, action: UIEvent | AgentResetAction) => AgentState`. Existing callers passing plain `UIEvent` remain type-safe.

### Behavior

- `reset` (both the synthetic `__reset__` and wire `ui.reset`) **clears pending navigate** — pending navigates are stale intent after a reset and should not fire.
- `reset` **always returns a fresh state reference**, even when state is already empty. Simpler invariant; consumers can memoize if needed.

### Migration

If you were tracking an `agentNodeOffset` to keep nodes from session A out of session B's render, you can delete it and call `reset()` on session change:

```tsx
const { state, reset } = useAgentStream({ url, sessionId });
useEffect(() => {
  reset();
}, [sessionId, reset]);
```
