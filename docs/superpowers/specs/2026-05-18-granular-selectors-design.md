# Granular state selectors (DET-136 / v0.4.2)

Linear: [DET-136 — v0.4 — Granular state selectors (`useAgentNodes` / `useAgentToasts` / `useAgentNavigate` / `useAgentSelector`)](https://linear.app/detailing-app/issue/DET-136)

## Goal

Stop forcing every consumer of `useAgentStream().state` to re-render when an unrelated slice changes. Ship a subscribable store inside `useAgentStream` and four selector hooks on top of it. Unblocks DET-134 (collapse `ChatStreamCtx` / `ChatSessionCtx` split in detailing-app).

## Non-goals

- A lifecycle provider that bundles session + stream + selectors together. That's `<AgentRoot>` in DET-142 (v0.5).
- Auto-providing the store from `useAgentStream` (keeping the seam visible lets selector hooks work for non-stream stores: tests, hosts that drive state from a non-SSE source).
- Runtime warnings on direct `state` access. The ticket asks to "document the perf delta" — that's docs, not a console.warn path.
- A `zustand` dependency. Implementation is ~80 lines of standalone code.

## Public API

```ts
// packages/react/src/store.ts (new)
export interface AgentStore {
  getState(): AgentState;
  subscribe(listener: () => void): () => void;   // returns unsubscribe
  send(action: AgentAction): void;                // dispatches through agentReducer
  reset(): void;                                   // shorthand for send({ op: "__reset__" })
}

export function createAgentStore(initial?: AgentState): AgentStore;
```

```ts
// packages/react/src/agent-state-context.tsx (new)
export interface AgentStateProviderProps {
  store: AgentStore;
  children: ReactNode;
}
export function AgentStateProvider(props: AgentStateProviderProps): JSX.Element;
```

```ts
// packages/react/src/selectors.ts (new)
export function useAgentNodes(): UINode[];
export function useAgentToasts(): Toast[];
export function useAgentNavigate(): { href: string; replace?: boolean } | null;
export function useAgentSelector<T>(
  selector: (state: AgentState) => T,
  eq?: (a: T, b: T) => boolean,   // default Object.is
): T;
```

```ts
// packages/react/src/use-agent-stream.ts (extended type)
export interface UseAgentStreamResult {
  state: AgentState;
  status: StreamStatus;
  close: () => void;
  reset: () => void;
  dispatch: (event: UIEvent) => void;
  store: AgentStore;            // NEW — pass into <AgentStateProvider>
}
```

## Architecture

```
┌─────────────────────┐
│ EventSource (SSE)   │
└──────────┬──────────┘
           │ JSON messages
           ▼
┌─────────────────────┐
│ useAgentStream      │  (creates store in a ref, calls store.send(event))
└──────────┬──────────┘
           │ exposes .state (back-compat) + .store
           ▼
┌─────────────────────┐         ┌───────────────────────────┐
│ AgentStateProvider  │◄────────│ consumer wires store=     │
│ (context)           │         │   stream.store            │
└──────────┬──────────┘         └───────────────────────────┘
           │ context value = store
           ▼
┌─────────────────────┐
│ useAgentNodes()     │  useSyncExternalStore(store.subscribe, getSnapshot)
│ useAgentToasts()    │
│ useAgentNavigate()  │
│ useAgentSelector()  │
└─────────────────────┘
```

### Store

A closure over `let state: AgentState` plus a `Set<() => void>` of listeners.

```ts
// store.ts (sketch)
export function createAgentStore(initial = createInitialAgentState()): AgentStore {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    send(action) {
      const next = agentReducer(state, action);
      if (next === state) return;       // reducer can short-circuit
      state = next;
      listeners.forEach((l) => l());
    },
    reset() {
      this.send({ op: "__reset__" });
    },
  };
}
```

No batching — React 18 already batches re-renders within an event loop tick. No middleware, no devtools hooks (out of scope; DET-145 in v0.6 is the DevTools ticket).

### useAgentStream refactor

```ts
function useAgentStream(options) {
  const storeRef = useRef<AgentStore | null>(null);
  if (storeRef.current === null) storeRef.current = createAgentStore();
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.getState);
  // ...existing EventSource logic, but dispatch via store.send(parsed.value)
  // close / reset / dispatch route through store too
  return { state, status, close, reset, dispatch, store };
}
```

The `state` field keeps the same shape and semantics as before, just plumbed through `useSyncExternalStore` instead of `useReducer`. Existing tests in `use-agent-stream.test.tsx` should keep passing without changes.

### Selector mechanics

`useSyncExternalStore` compares snapshots with `Object.is`. To honor a user-supplied `eq`, we cache the last returned value in a ref and only update it when `eq(prev, next)` is false. Refs hold the latest selector and eq so `getSnapshot` stays referentially stable across renders.

```ts
const UNSET = Symbol("unset");

export function useAgentSelector<T>(
  selector: (s: AgentState) => T,
  eq: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useAgentStore();   // internal hook reading context
  const selRef = useRef(selector); selRef.current = selector;
  const eqRef  = useRef(eq);       eqRef.current  = eq;
  const lastRef = useRef<T | typeof UNSET>(UNSET);

  const getSnapshot = useCallback(() => {
    const next = selRef.current(store.getState());
    if (lastRef.current !== UNSET && eqRef.current(lastRef.current as T, next)) {
      return lastRef.current as T;
    }
    lastRef.current = next;
    return next;
  }, [store]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  //                          subscribe        client          server
}
```

The third argument (`getServerSnapshot`) reuses `getSnapshot` — there's no server-side rendering distinction here; `state` is just a JS object.

The three convenience hooks are one-liners over `useAgentSelector`:

```ts
export const useAgentNodes    = () => useAgentSelector((s) => s.nodes);
export const useAgentToasts   = () => useAgentSelector((s) => s.toasts);
export const useAgentNavigate = () => useAgentSelector((s) => s.navigate);
```

Default `Object.is` is correct because `agentReducer` already returns the same outer-state reference for slice-irrelevant transitions, with each slice (`nodes`, `toasts`, `navigate`) reference-replaced only when that slice changes. A `ui.toast` event produces `{ ...state, toasts: [...] }` — `state.nodes` keeps its old reference and `useAgentNodes` consumers don't re-render.

### Provider error semantics

`useAgentStore()` (the internal accessor) throws a clear error when no provider is mounted:

```
Error: useAgentNodes / useAgentSelector must be used inside <AgentStateProvider>.
Wire it up with: const { store } = useAgentStream(...); then wrap children in <AgentStateProvider store={store}>.
```

This is opt-in by use — selector hooks fail loudly, but consumers still happily use `useAgentStream().state` directly without a provider.

## Behavior

### Re-render boundary

| Event | `useAgentNodes` re-renders? | `useAgentToasts` re-renders? | `useAgentNavigate` re-renders? | `state`-reader re-renders? |
|---|---|---|---|---|
| `ui.append` | yes | no | no | yes |
| `ui.replace` | yes (nodes array is rebuilt) | no | no | yes |
| `ui.remove` | yes | no | no | yes |
| `ui.toast` | no | yes | no | yes |
| `ui.navigate` | no | no | yes | yes |
| `ui.reset` / `__reset__` | yes (cleared) | yes (cleared) | yes (cleared) | yes |

This is the property test #1 anchors. Worth nailing in test code.

### Custom `eq`

```ts
const status = useAgentSelector(
  (s) => s.byKey.get("primary-cta"),
  (a, b) => a === b,                 // numeric index — default Object.is would suffice
);
```

The custom `eq` runs against the *selector's* return value, not against state. A selector returning a new object per call (`s => ({ id: s.nodes[0]?.key })`) needs a custom eq to be stable; the default would re-render on every notification.

### Edge cases

- **Selector throws.** Propagates. We don't catch — selectors are host code.
- **`eq` throws.** Propagates. Same reasoning.
- **Store is replaced between renders.** `getSnapshot` is rebuilt with the new store via the `[store]` useCallback dep, the subscription is re-established by React's internal logic in `useSyncExternalStore`.
- **Consumer of `state` and consumer of `useAgentNodes` coexist.** Both work; the `state`-reader is just a less-efficient selector.
- **Selector that depends on `Map` identity (`s => s.byKey`).** Works — `byKey` is rebuilt on `ui.append`/`ui.replace`/`ui.remove` (per `agentReducer`'s `rebuildIndex`) and reference-stable across toast/navigate events. Test #3 anchors this.

## Tests

New file: `packages/react/test/selectors.test.tsx`. Five tests:

1. **`useAgentNodes` does not re-render when only a toast arrives.** Render two probe components — `<NodesProbe>` calls `useAgentNodes()`, `<ToastsProbe>` calls `useAgentToasts()`. Each increments an external render-counter on every render. Mount them under an `AgentStateProvider` wired to a fresh `createAgentStore()`. Initial render: both counters at 1. Send a `ui.toast` event via `store.send(...)`. After flush: nodes counter still 1, toasts counter at 2.

2. **`useAgentSelector(s => s.nodes.length)` is stable across `ui.replace`.** Append one node (counter increments). Replace its props (replace produces a new nodes array, but length === 1 still). Counter must not increment again.

3. **`useAgentSelector(s => s.byKey.get('foo'))` updates only for that key.** Append `a, b, foo`. Probe selector for `byKey.get('foo')`. Initial value: 2. Remove `a` (foo's index becomes 1, counter +1). Remove a node that isn't `foo` (counter unchanged from this point).

4. **Custom `eq` is honored.** Selector returns `{ id: s.nodes[0]?.key }` — a fresh object literal every call. Default `Object.is` would re-render on every notification; pass `eq: (a, b) => a?.id === b?.id`. Send an unrelated toast event. Counter must not increment.

5. **Hook used outside a provider throws.** `expect(() => render(<NodesProbe />)).toThrow(/AgentStateProvider/)`. Silences `console.error` via `vi.spyOn` per the pattern from renderer tests.

### Test infrastructure

`packages/react/test/selectors.test.tsx` mounts components against a standalone `createAgentStore()` — no SSE / `useAgentStream` involvement. Keeps the test about the selector contract, not about the stream plumbing. The existing `use-agent-stream.test.tsx` already validates the stream-side behavior; it should continue passing under the refactor (the surface `{ state, status, close, reset, dispatch }` is unchanged).

## File touches

| File | Action |
|---|---|
| `packages/react/src/store.ts` | Create |
| `packages/react/src/agent-state-context.tsx` | Create |
| `packages/react/src/selectors.ts` | Create |
| `packages/react/src/use-agent-stream.ts` | Modify (internal store; expose on return) |
| `packages/react/src/index.ts` | Modify (new exports: `createAgentStore`, `AgentStore`, `AgentStateProvider`, `AgentStateProviderProps`, `useAgentNodes`, `useAgentToasts`, `useAgentNavigate`, `useAgentSelector`) |
| `packages/react/test/selectors.test.tsx` | Create (5 tests) |
| `packages/react/test/use-agent-stream.test.tsx` | Re-run; touch only if the refactor breaks something |
| `CHANGELOG.md` | Append to the existing `0.4.0` section under "Added — `@kibadist/agentui-react`" |
| `README.md` | Short subsection under "Renderer: range, filter, ..." titled "Granular state selectors" with one example and the perf-delta line |

## Migration

Additive. Consumers continue using `state` directly. The preferred path on hot rendering surfaces (anything inside the AgentRenderer subtree or that re-renders per node) is:

```diff
- const { state } = useAgentStream({ url, sessionId });
- const nodes = state.nodes;
+ const { store } = useAgentStream({ url, sessionId });
+ // ...wrap children in <AgentStateProvider store={store}>
+ // inside children:
+ const nodes = useAgentNodes();
```

The detailing-app migration (DET-134) replaces its `ChatStreamCtx` / `ChatSessionCtx` pair with a single `<AgentStateProvider>` and selector calls — that's the consumer side of this ticket.

## Open questions

None blocking. Two decided inline:

- **Should `AgentStateProvider` accept an optional `initialState`?** No. The store handles initial state at construction; the provider just hands the store to context. Avoids a confusing dual init path.
- **Should we add `useAgentStatus()` for `StreamStatus`?** No. Status lives on `useAgentStream`'s return, not in the reducer state. Wrapping it in a selector hook would require pushing status into the store, which conflates "session shape" with "stream state." Out of scope; revisit in DET-142 if `<AgentRoot>` consolidates them.
