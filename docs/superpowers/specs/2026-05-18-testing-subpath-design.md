# Testing subpath (DET-137 / v0.4.3)

Linear: [DET-137 — v0.4 — `/testing` subpath (MockAgentStream, pushEvent, replayConversation, createTestRegistry)](https://linear.app/detailing-app/issue/DET-137)

## Goal

Ship `@kibadist/agentui-react/testing` so consumers stop hand-rolling vitest module mocks of the entire React package. Four helpers cover the common surfaces: a fake stream hook with a control surface, two pure reducer helpers, and a registry that auto-stubs unknown types with a marker component.

## Non-goals

- Module-mock automation (an `installMockReactPackage(vi)` helper). Hosts can run `vi.mock('@kibadist/agentui-react', ...)` themselves; baking it in pins us to one test runner.
- Storybook adapter, server-test helpers, runtime fixtures. Different surfaces; if any of them is wanted, separate tickets.
- A runtime `vitest` dependency. The helpers don't import from vitest.
- A second published package. Lives under the same `@kibadist/agentui-react` artifact at a subpath.

## Public API

```ts
// from "@kibadist/agentui-react/testing"

export function createMockAgentStream(initial?: Partial<AgentState>): MockAgentStream;

export interface MockAgentStream {
  /** Drop-in for `useAgentStream`. Call inside a React render context. */
  hook: () => UseAgentStreamResult;
  /** The underlying AgentStore. Wire into `<AgentStateProvider store={...}>`. */
  store: AgentStore;
  /** Simulate inbound SSE (typed to UIEvent — wire-level events only). */
  push: (event: UIEvent) => void;
  /** Reducer-level injection. Accepts `AgentAction` (UIEvent | AgentResetAction). */
  dispatchInternal: (action: AgentAction) => void;
  /** Drive the StreamStatus subscribers (idle / connecting / open / closed / error). */
  setStatus: (status: StreamStatus) => void;
  /** Shorthand for `store.reset()`. */
  reset: () => void;
  /** Live snapshot — readable for assertions (getter; always reflects current state). */
  readonly state: AgentState;
  /** Recorded actions in dispatch order. Mutated in place. Snapshot with `[...history]`. */
  history: AgentAction[];
}

export function pushEvent(state: AgentState, event: UIEvent): AgentState;

export function replayConversation(events: UIEvent[]): AgentState;

export function createTestRegistry(map: Record<string, ComponentSpec>): Registry;
```

### Deviation from ticket: `store` on the return shape

The ticket's signature didn't list `store` on the mock's return. I'm adding it — the v0.4.2 selector hooks require `<AgentStateProvider store={...}>` as an ancestor, and the ergonomic wiring is `<AgentStateProvider store={mock.store}>`. Without exposing `store`, tests would have to call `mock.hook()` from inside a probe component to obtain the store, which is clunky. Strict superset of the ticket; no incompatibility.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ packages/react/src/testing/                                  │
│                                                              │
│   index.ts                — re-exports                       │
│   mock-agent-stream.ts    — createMockAgentStream            │
│   replay.ts               — pushEvent, replayConversation    │
│   test-registry.tsx       — createTestRegistry + marker      │
│                                                              │
│   Build:  tsc emits to dist/testing/index.js + .d.ts         │
│   Import: @kibadist/agentui-react/testing                    │
└─────────────────────────────────────────────────────────────┘
```

### Why a subdirectory and not a separate package

A separate package would need its own publishing step, version coordination with the main package, and a second dep entry for every consumer. The single-package + subpath pattern (used by `@testing-library/react/jest-dom`, `next/headers`, etc.) is the React ecosystem default for this scope of helper module.

### createMockAgentStream implementation

```ts
import { useSyncExternalStore } from "react";
import { createAgentStore, type AgentStore } from "../store.js";
import { createInitialAgentState, type AgentAction, type AgentState } from "../reducer.js";
import type { UIEvent } from "@kibadist/agentui-protocol";
import type { StreamStatus, UseAgentStreamResult } from "../use-agent-stream.js";

export function createMockAgentStream(initial?: Partial<AgentState>): MockAgentStream {
  const store = createAgentStore({ ...createInitialAgentState(), ...initial });
  const history: AgentAction[] = [];
  let currentStatus: StreamStatus = "idle";
  const statusListeners = new Set<() => void>();

  // Wrap send to record dispatch history. Captures both push() and dispatchInternal()
  // since both route through store.send.
  const originalSend = store.send;
  store.send = (action) => {
    history.push(action);
    originalSend(action);
  };

  const hook = (): UseAgentStreamResult => {
    const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
    const status = useSyncExternalStore(
      (l) => { statusListeners.add(l); return () => statusListeners.delete(l); },
      () => currentStatus,
      () => currentStatus,
    );
    return {
      state,
      status,
      store,
      close: () => {
        currentStatus = "closed";
        statusListeners.forEach((l) => l());
      },
      reset: () => store.reset(),
      dispatch: (event) => store.send(event),
    };
  };

  return {
    hook,
    store,
    push: (event: UIEvent) => store.send(event),
    dispatchInternal: (action: AgentAction) => store.send(action),
    setStatus: (status: StreamStatus) => {
      currentStatus = status;
      statusListeners.forEach((l) => l());
    },
    reset: () => store.reset(),
    get state() { return store.getState(); },
    history,
  };
}
```

Notes:
- `state` is a getter, not a captured snapshot. Always reflects `store.getState()` at read time.
- `history` records `store.send`, which captures both `push()` and `dispatchInternal()` AND any internal calls (e.g., `store.reset()` calls `store.send({ op: "__reset__" })`).
- The status sub-store is implemented inline (mutable `currentStatus` + a Set of listeners) rather than introducing a second `createAgentStore` — keeps the helper file under 60 lines.
- `close()` is implemented as "set status to closed" rather than a no-op, so tests that drive lifecycle assertions get realistic behavior.

### pushEvent + replayConversation

Pure functions, no React. Direct wrappers over `agentReducer`.

```ts
export function pushEvent(state: AgentState, event: UIEvent): AgentState {
  return agentReducer(state, event);
}

export function replayConversation(events: UIEvent[]): AgentState {
  let state = createInitialAgentState();
  for (const event of events) state = agentReducer(state, event);
  return state;
}
```

Both signatures take `UIEvent` (not `AgentAction`). Hosts wanting to thread `__reset__` use the mock's `dispatchInternal()`. Type-enforced at the boundary.

### createTestRegistry

A Registry that wraps `createRegistry(map)` and falls back to a memoized marker component for any unregistered type. The marker renders a span with `data-testid="test-marker-{type}"` and serializes its props into the body for assertion convenience.

```tsx
import { type ComponentType } from "react";
import { createRegistry, type ComponentSpec, type Registry } from "../registry.js";

// Module-level cache: stable component identity across createTestRegistry calls.
const markerCache = new Map<string, ComponentType<Record<string, unknown>>>();

function getMarker(type: string): ComponentType<Record<string, unknown>> {
  const cached = markerCache.get(type);
  if (cached) return cached;
  const Marker = (props: Record<string, unknown>) => (
    <span data-testid={`test-marker-${type}`}>{JSON.stringify(props)}</span>
  );
  Marker.displayName = `TestMarker(${type})`;
  markerCache.set(type, Marker);
  return Marker;
}

export function createTestRegistry(map: Record<string, ComponentSpec>): Registry {
  const base = createRegistry(map);
  return {
    get(type) { return base.get(type) ?? { component: getMarker(type) }; },
    has() { return true; },           // never falls to the renderer's missing-type path
    types() { return base.types(); }, // only explicitly-registered types
  };
}
```

The shared marker cache makes the same unknown type resolve to the same component reference across `createTestRegistry()` calls — important for React reconciliation if tests reuse a marker across rerenders.

### Build / packaging

**`packages/react/package.json` `exports`:**

```jsonc
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "default": "./dist/index.js"
  },
  "./testing": {
    "types": "./dist/testing/index.d.ts",
    "import": "./dist/testing/index.js",
    "default": "./dist/testing/index.js"
  }
}
```

**`packages/react/tsconfig.json`:** already has `include: ["src"]` which globs `src/testing/**` automatically. No change needed.

**`packages/react/package.json` `files: ["dist"]`:** unchanged — `dist/testing/` is a subdirectory and rides along.

**`devDependencies`:** vitest remains absent from this package (it's at the workspace root). The helpers don't import from vitest.

### TypeScript subpath resolution

TypeScript's `moduleResolution: "bundler"` (in `tsconfig.base.json`, inherited) reads the `exports` map's `"types"` field automatically. Consumers don't need to add a `paths` entry. Verified by the existing `@kibadist/agentui-protocol` → `@kibadist/agentui-react` resolution working without explicit `paths`.

### Re-exports the helpers depend on

The helpers reference existing public types/values:

- `UseAgentStreamResult`, `StreamStatus` — from `use-agent-stream.ts` (public)
- `AgentStore`, `createAgentStore` — from `store.ts` (public)
- `AgentState`, `AgentAction`, `agentReducer`, `createInitialAgentState` — from `reducer.ts` (public)
- `Registry`, `ComponentSpec`, `createRegistry` — from `registry.ts` (public)
- `UIEvent` — from `@kibadist/agentui-protocol` (public)

No new public exports from the main entry are needed.

## Tests (the ticket requires two reference specs)

New directory: `packages/react/test/testing/`.

### `mock-agent-stream.test.tsx`

End-to-end demonstration of the mock driving a consumer that uses selector hooks.

1. **`createMockAgentStream({}).hook()` returns the right shape and reacts to `push`.** Render a probe component that calls `useAgentNodes()` under `<AgentStateProvider store={mock.store}>`. Call `mock.push(uiAppendEvent("a"))` inside `act()`. Assert the probe's reported node count is 1 and the node key is "a".
2. **`setStatus` flows to consumers of the hook's `status` field.** Render a probe that calls `mock.hook().status`. Drive `mock.setStatus("error")` inside `act()`. Assert the probe sees `"error"`.
3. **`history` records all dispatched actions in order.** Push three events; assert `mock.history.length === 3` and the third entry's `op` matches the third event's `op`.
4. **`mock.state` is a live getter, not a frozen snapshot.** Push an event; read `mock.state.nodes.length` immediately afterward (outside React). Assert it equals 1.

### `replay.test.ts`

10-event reducer spec, per the ticket.

```ts
it("replayConversation folds a 10-event mixed sequence to the expected state", () => {
  const events: UIEvent[] = [
    appendEvent("a"),
    appendEvent("b"),
    appendEvent("c"),
    replaceEvent("b", { x: 1 }),
    toastEvent("hello"),
    appendEvent("d"),
    removeEvent("a"),
    toastEvent("world"),
    navigateEvent("/dashboard"),
    replaceEvent("d", { y: 2 }),
  ];
  const state = replayConversation(events);
  expect(state.nodes.map((n) => n.key)).toEqual(["b", "c", "d"]);
  expect(state.byKey.get("d")).toBe(2);
  expect(state.toasts.map((t) => t.message)).toEqual(["hello", "world"]);
  expect(state.navigate).toEqual({ href: "/dashboard", replace: undefined });
});

it("pushEvent runs one event through the reducer", () => {
  const s0 = createInitialAgentState();
  const s1 = pushEvent(s0, appendEvent("a"));
  expect(s1.nodes).toHaveLength(1);
  expect(s1).not.toBe(s0);  // pure — new state reference
});
```

### `test-registry.test.tsx` (bonus, not strictly required by the ticket)

Three small tests:
- Known types resolve to the supplied component (assert by rendering via `AgentRenderer`).
- Unknown types resolve to a marker span: `data-testid="test-marker-mystery"` appears in the DOM with serialized props in its body.
- The same unknown type returns the same component reference on repeated `get(...)` calls (marker cache works).

## Edge cases

- **`mock.history` mutation in user code.** History is a real array; consumers can `.length = 0` to reset it between assertions. Documented in JSDoc.
- **Marker cache across test files.** The cache is module-scoped, so different `*.test.tsx` files share the same marker for a given `type`. This is intentional — guarantees reference stability. If isolation is ever needed, that's a follow-up ticket.
- **`mock.hook()` called outside React render context.** Will throw a React internal error (something like "Hooks can only be called inside the body of a function component"). Not our concern — same constraint as any React hook.
- **Initial state mismatch.** `createMockAgentStream({ toasts: [{ id, level: "info", message: "hi", ts }] })` is valid — `Partial<AgentState>` allows overriding any slice. The `byKey` index is rebuilt iff `nodes` is also overridden; otherwise it's the empty Map from `createInitialAgentState()`. Documented in JSDoc with one example.
- **Setting status to `"closed"` from `close()`.** Test that `close()` flows through `setStatus("closed")` so consumers see lifecycle changes correctly.

## Migration

Additive. Existing inline mocks keep working. The detailing-app migration path:

```diff
- vi.mock('@kibadist/agentui-react', () => ({
-   ...vi.importActual('@kibadist/agentui-react'),
-   useAgentStream: () => ({ state: { nodes: [], toasts: [], navigate: null, byKey: new Map() }, ... }),
- }));
+ import { createMockAgentStream } from '@kibadist/agentui-react/testing';
+ const mock = createMockAgentStream({ nodes: [...] });
+ vi.mock('@kibadist/agentui-react', async (orig) => ({
+   ...(await orig()),
+   useAgentStream: mock.hook,
+ }));
```

## File touches

| File | Action |
|---|---|
| `packages/react/src/testing/index.ts` | Create — re-exports |
| `packages/react/src/testing/mock-agent-stream.ts` | Create — ~60 lines |
| `packages/react/src/testing/replay.ts` | Create — ~10 lines |
| `packages/react/src/testing/test-registry.tsx` | Create — ~25 lines |
| `packages/react/package.json` | Modify — add `"./testing"` to `exports` |
| `packages/react/test/testing/mock-agent-stream.test.tsx` | Create — 4 tests |
| `packages/react/test/testing/replay.test.ts` | Create — 2 tests |
| `packages/react/test/testing/test-registry.test.tsx` | Create — 3 tests |
| `CHANGELOG.md` | Modify — append to 0.4.0 |
| `README.md` | Modify — short subsection under selectors |

## Open questions

None blocking. One decided inline:

- **Should `createTestRegistry` validate that the supplied map's entries don't conflict with marker behavior?** No. The contract is: known types use supplied specs; unknown types get marker fallbacks. Tests that want to assert "unknown type X renders a marker" just omit X from the map.
