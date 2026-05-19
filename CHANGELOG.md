# Changelog

All notable changes to `@kibadist/agentui-*` packages.

## 0.8.0 — 2026-05-19

### Added
- `ui.replace` events now accept an alternate `patch` payload (RFC 6902 JSON Patch). Lets agents emit minimal deltas for deeply nested nodes. Both `props` and `patch` forms remain valid and can interleave for the same key. ([DET-151](https://linear.app/detailing-app/issue/DET-151))
- New `applyPatch` helper exported from `@kibadist/agentui-react` for in-process patch application.
- New `onPatchFailure` option on `createAgentStore`; `useAgentStream` wires it into `onInvalidEvent` with a `patch apply failed: …` message.
- New protocol exports: `JsonPatch`, `JsonPatchOp`, `JsonPointer`, `UIReplacePropsEvent`, `UIReplacePatchEvent`.
- New `parsePartialJson<T>(text)` and `streamingJsonParse<T>(source)` helpers exported from `@kibadist/agentui-react`. The reducer uses `parsePartialJson` so tool-call args update progressively after each `tool.args-delta`. ([DET-152](https://linear.app/detailing-app/issue/DET-152))
- New `session.init` wire event declares node types, actions, and effective permissions. `AgentRenderer` gates on `ComponentSpec.requires`; consumers read the declaration via `useCapabilities()` (returns `hasPermission`, `canAct`, `canEmit`). Servers that don't emit `session.init` see no behavior change. ([DET-153](https://linear.app/detailing-app/issue/DET-153))

## 0.7.1

### Added
- `<AgentRoot caps={{ maxNodes, maxToasts, maxToolCalls, maxReasoning, onEvict }}>` — per-slice memory caps with drop-oldest eviction. `onEvict(slice, evicted)` fires once per dispatch that exceeds a cap.
- `<AgentRoot onMetric={...} tags={...}>` — observability hooks. Seven metrics in the `agentui.*` namespace cover session lifecycle, stream lifecycle, and per-event parse/dispatch durations. Host-provided `tags` propagate on every metric.
- New types: `Metric`, `MetricEmitter`, `CapsConfig`, `EvictableSlice` re-exported from `@kibadist/agentui-react`.

### Notes
- Metrics emit synchronously and are no-op when `onMetric` is unset (zero allocations).
- Caps apply only when explicitly set; the default 50-toast trim remains in place.
- Session ids are FNV-1a hashed (8 hex chars) before landing in metric tags; raw UUIDs are never tagged.

## 0.7.0

### Added
- `useAgentStream` now supports three opt-in configs: `retry` (max attempts + exponential backoff with jitter), `buffer` (bounded event queue with drop-oldest/drop-newest/block-stream/callback overflow strategies), and `auth` (token-refresh hook + `Last-Event-ID` resume on reconnect).
- New `StreamStatus` values: `reauthenticating` (waiting for `auth.getToken()` / `auth.onUnauthorized()`) and `reconnecting` (sleeping the backoff delay between attempts).

### Changed
- The SSE transport now uses `fetch` + `ReadableStream` instead of the native `EventSource`. Behavior is observably the same for consumers who don't supply any of the new configs (still retries forever, no buffer cap). Browsers and Node ≥18 are supported; the Edge runtime works in Next.js App Router.

### Migration
- Hosts that exhaustively switch on `StreamStatus` need a default branch for the two new members. TypeScript with `--noFallthroughCasesInSwitch` will flag this.
- Servers SHOULD include an `id:` line on each SSE event and SHOULD replay buffered events on reconnect when `Last-Event-ID` is sent. Without these, the client still works — there's just no event resumption.

## 0.6.4

### Added
- `defineNode({ type, schema, component, requires })` in `@kibadist/agentui-react`: schemas become the source of truth. Component props are inferred from the Zod schema; `Node.build({ key, props })` validates at emit time and produces a `UINode` wire payload. Capability requirements set on `defineNode` flow into `UINode.meta.requires` automatically.
- `createRegistry([NodeA, NodeB])` array overload accepts `NodeDefinition[]`. The existing `createRegistry({ "type": spec })` object form continues to work unchanged.
- `zod` listed as an **optional peer dependency** of `@kibadist/agentui-react`. Required only when calling `defineNode` or supplying a Zod `propsSchema` to the legacy object form.

### Notes
- Type-level safety verified via vitest `expectTypeOf` and `@ts-expect-error` in `packages/react/test/define-node.test-d.ts`.
- Auto-migration codemod (`@kibadist/agentui-codemods`) deferred — both API forms are supported indefinitely.

## 0.6.3

### Added
- `@kibadist/agentui` CLI package: `npx @kibadist/agentui new-node <PascalCaseName>` scaffolds a typed component (tsx + Zod schema + vitest scaffold), and inserts a registry entry via marker comments. Optional Storybook story when `@storybook/react` or `@storybook/nextjs` is detected in the host `package.json`.

### Notes
- Subsequent CLI commands (`init`, `add-registry-markers`) deferred to a later minor.
- Registry insertion requires the host project to add `// agentui:registry-imports-start|end` and `// agentui:registry-entries-start|end` marker comments one time.

## 0.6.2

### Added

- **`@kibadist/agentui-react/devtools`** — new subpath export. Ships `<AgentDevTools />`, a floating debug panel with a live wire-event log, current `AgentState` tree, dispatch latency stats, and a time-travel scrubber.
  - Opt-in by default in non-production; production builds must set `NEXT_PUBLIC_AGENTUI_DEVTOOLS=1` (or pass `enabled` explicitly).
  - The panel doesn't rewind the host app — scrubbing only changes what the panel renders.
- **`AgentStore.subscribeAction(listener)`** — public API addition. Notifies listeners with `(action, nextState, dispatchMs)` after every non-no-op dispatch. Hosts that implement custom stores (rare) must add the method.
- `replayConversation` parameter type widened from `UIEvent[]` to `AgentAction[]` (excluding the internal `__reset__`). Existing call sites are unaffected.
- `replayConversation`, `pushEvent`, and the `ReplayableEvent` type are now re-exported from `@kibadist/agentui-react/devtools` for parity with `/testing`.

### Notes

This release ships the recording engine, scrubber, event log, and state tree. The following polish items from the design spec are deferred to a follow-up ticket: drag-and-drop positioning + `localStorage` persistence of the panel position, list virtualization for the event log, a histogram-tooltip on the latency indicator, and multi-`<AgentRoot>` scoping via an `id` prop on `<AgentDevTools />`. The `id` prop has been removed from the public API for v0.6.2 to avoid shipping a silent no-op.

## 0.6.0

### Added — new package `@kibadist/agentui-llm`

- **Provider-native stream adapters.** Three async-generator functions that map LLM streaming responses to AgentUI `AgentWireEvent`:
  - `fromAnthropic(stream)` — text deltas, tool_use blocks, thinking (extended-reasoning) blocks, stream errors.
  - `fromOpenAI(stream)` — text deltas and tool_calls. (Reasoning via the Responses API is out of scope for v0.6.1.)
  - `fromGemini(stream)` — text (delta-via-diff) and functionCall. (Reasoning is not yet stable in the public Gemini streaming API.)
- All adapters accept `{ sessionId?, textKey? }` options and yield validated wire events. Stream errors yield a `ui.toast` with `level: "error"`.
- `tool.result` is NOT emitted by adapters — that's host-driven after executing the tool.
- Peer-dependencies on the three provider SDKs are marked optional so hosts only install what they need.

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
