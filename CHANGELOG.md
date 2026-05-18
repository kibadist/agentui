# Changelog

All notable changes to `@kibadist/agentui-*` packages.

## 0.4.0

### Added — `@kibadist/agentui-react`

- `AgentRenderer` gains five additive props: `range`, `filter`, `hiddenTypes`, `errorFallback`, `nodeWrapper`. Composition order is `slot → range → filter → hiddenTypes`. All five default to no-op — callers that don't pass them see identical behavior to `0.3.x`.
  - Replaces hand-rolled `SlicedAgentRenderer` wrappers, per-node `<ErrorBoundary>` wrapping, and ad-hoc `hiddenTypes` filtering in consumer code.
- `AgentRendererProps` type is now exported from `@kibadist/agentui-react` for consumers composing on top of the renderer.

### Behavior

- The internal error boundary only attaches when `errorFallback` is set — no reconciliation overhead for consumers who don't use it.
- `nodeWrapper` is the outermost layer per node; it stays mounted even when the inner component throws and is caught by `errorFallback` (lets `<AnimatePresence>`-style wrappers track keys cleanly).
- Per-node React keys are now placed on an invisible `React.Fragment` for consistency across all wrapper combinations. No DOM impact.
- **Minor:** when a node's type is missing from the registry and a `fallback` is provided, the renderer now returns the fallback content directly. Previously it wrapped the result in a `<span>`. The React key now lives on the outer Fragment, so reconciliation is unchanged — but any CSS or DOM-query that relied on the `<span>` wrapper around fallback output will need to be updated.

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
