# Granular Selectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a subscribable `AgentStore` + four selector hooks (`useAgentNodes`, `useAgentToasts`, `useAgentNavigate`, `useAgentSelector`) so consumers stop re-rendering on unrelated state changes. Strictly additive — `useAgentStream().state` keeps working.

**Architecture:** Build the store first (closure over `let state` + `Set<Listener>`, `send` runs `agentReducer`). Wrap the store in a React context via `<AgentStateProvider>`. Selector hooks read from context and subscribe via `useSyncExternalStore` with a ref-cached snapshot for user-supplied `eq` functions. `useAgentStream` is refactored last: it creates the store internally and exposes it on the return so consumers can wire `<AgentStateProvider store={stream.store}>`.

**Tech Stack:** TypeScript strict, React 19, `useSyncExternalStore`. Vitest + jsdom + @testing-library/react. No new runtime deps.

**Spec:** [docs/superpowers/specs/2026-05-18-granular-selectors-design.md](../specs/2026-05-18-granular-selectors-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/react/src/store.ts` | Create | `createAgentStore()` factory + `AgentStore` type. Pure JS — no React. |
| `packages/react/src/agent-state-context.tsx` | Create | `AgentStateProvider` + internal `useAgentStore` (throws if no provider). |
| `packages/react/src/selectors.ts` | Create | `useAgentSelector` + three convenience hooks. |
| `packages/react/src/use-agent-stream.ts` | Modify | Replace `useReducer` with internal `AgentStore`; expose `store` on return. |
| `packages/react/src/index.ts` | Modify | Export new public symbols. |
| `packages/react/test/store.test.ts` | Create | Unit tests for `createAgentStore`. |
| `packages/react/test/selectors.test.tsx` | Create | Five tests per spec. Mounts selectors against a standalone store (no SSE). |
| `packages/react/test/use-agent-stream.test.tsx` | (probably unchanged) | Existing tests must keep passing after Task 4's refactor. |
| `CHANGELOG.md` | Modify | Extend the existing `0.4.0` section. |
| `README.md` | Modify | New subsection under "Renderer: range, …". |

---

## Conventions used throughout this plan

- All commands run from `/Users/max/agentui`.
- Test runner: `pnpm test` (one-shot — wired to `vitest run`). **Never** invoke watch mode.
- Workspace typecheck: `pnpm --filter @kibadist/agentui-react typecheck`.
- All tests import internal symbols via `../src/index.js` (ESM-only repo).
- Test helpers reused across selectors tests:

```tsx
import type { UINode } from "@kibadist/agentui-protocol";
import type { AgentState } from "../src/index.js";

function makeNode(key: string, type = "test.box", props: Record<string, unknown> = {}): UINode {
  return { key, type, props };
}

function makeState(nodes: UINode[]): AgentState {
  const byKey = new Map<string, number>();
  nodes.forEach((n, i) => byKey.set(n.key, i));
  return { nodes, byKey, toasts: [], navigate: null };
}
```

---

## Task 1: AgentStore — `createAgentStore` factory + tests

**Files:**
- Create: `packages/react/src/store.ts`
- Create: `packages/react/test/store.test.ts`
- Modify: `packages/react/src/index.ts` (export the new symbols)

- [ ] **Step 1: Write the failing tests**

Create `packages/react/test/store.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { UIAppendEvent, UIToastEvent } from "@kibadist/agentui-protocol";
import { createAgentStore, createInitialAgentState } from "../src/index.js";

function appendEvent(key: string): UIAppendEvent {
  return {
    v: 1,
    id: `evt-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.append",
    node: { key, type: "test.node", props: {} },
  };
}

function toastEvent(message: string): UIToastEvent {
  return {
    v: 1,
    id: `evt-t-${message}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.toast",
    level: "info",
    message,
  };
}

describe("createAgentStore", () => {
  it("getState returns the initial state passed in (or empty default)", () => {
    const a = createAgentStore();
    expect(a.getState().nodes).toEqual([]);
    expect(a.getState().toasts).toEqual([]);

    const seeded = createInitialAgentState();
    seeded.nodes.push({ key: "a", type: "x", props: {} });
    const b = createAgentStore(seeded);
    expect(b.getState().nodes).toHaveLength(1);
  });

  it("send notifies subscribers when state changes", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.send(appendEvent("a"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further notifications", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    store.send(appendEvent("a"));
    unsub();
    store.send(appendEvent("b"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the reducer returns the same state (no-op action)", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    store.subscribe(listener);
    // ui.replace for a key that doesn't exist is a documented no-op in agentReducer
    store.send({
      v: 1,
      id: "evt-r",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "ui.replace",
      key: "does-not-exist",
      props: {},
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("reset clears state and notifies subscribers", () => {
    const store = createAgentStore();
    store.send(appendEvent("a"));
    store.send(toastEvent("hi"));
    expect(store.getState().nodes).toHaveLength(1);
    expect(store.getState().toasts).toHaveLength(1);

    const listener = vi.fn();
    store.subscribe(listener);
    store.reset();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().nodes).toEqual([]);
    expect(store.getState().toasts).toEqual([]);
  });

  it("each listener sees the current state via getState (no stale reads)", () => {
    const store = createAgentStore();
    let seenLength = -1;
    store.subscribe(() => {
      seenLength = store.getState().nodes.length;
    });
    store.send(appendEvent("a"));
    expect(seenLength).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `pnpm test packages/react/test/store.test.ts`
Expected: failure — `createAgentStore` is not exported (or doesn't exist yet).

- [ ] **Step 3: Implement `packages/react/src/store.ts`**

Create the file:

```ts
import { agentReducer, createInitialAgentState, type AgentAction, type AgentState } from "./reducer.js";

export interface AgentStore {
  getState(): AgentState;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Dispatch an action through `agentReducer` and notify listeners if state changed. */
  send(action: AgentAction): void;
  /** Shorthand for `send({ op: "__reset__" })`. */
  reset(): void;
}

export function createAgentStore(initial: AgentState = createInitialAgentState()): AgentStore {
  let state = initial;
  const listeners = new Set<() => void>();

  const store: AgentStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send(action) {
      const next = agentReducer(state, action);
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
    reset() {
      store.send({ op: "__reset__" });
    },
  };

  return store;
}
```

- [ ] **Step 4: Export `createAgentStore` and `AgentStore` from `packages/react/src/index.ts`**

Find the existing block:

```ts
export { agentReducer, initialAgentState, createInitialAgentState } from "./reducer.js";
export type { AgentState, AgentAction, AgentResetAction } from "./reducer.js";
```

Insert these two lines immediately below it:

```ts
export { createAgentStore } from "./store.js";
export type { AgentStore } from "./store.js";
```

- [ ] **Step 5: Typecheck + run the new test file**

Run: `pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/store.test.ts`
Expected: typecheck clean, `6 passed`.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `pnpm test`
Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/store.ts packages/react/src/index.ts packages/react/test/store.test.ts
git commit -m "feat(react): add createAgentStore subscribable store"
```

---

## Task 2: AgentStateProvider + internal `useAgentStore` hook

**Files:**
- Create: `packages/react/src/agent-state-context.tsx`
- Modify: `packages/react/src/index.ts` (export `AgentStateProvider` + `AgentStateProviderProps`)

The internal `useAgentStore` hook is NOT exported — it's an implementation detail consumed by the selector hooks in Task 3. We test the provider + hook together in Task 3 (every selector test exercises both). No standalone test file for this task.

- [ ] **Step 1: Create `packages/react/src/agent-state-context.tsx`**

```tsx
import { createContext, useContext, type ReactNode } from "react";
import type { AgentStore } from "./store.js";

const AgentStoreContext = createContext<AgentStore | null>(null);

export interface AgentStateProviderProps {
  store: AgentStore;
  children: ReactNode;
}

export function AgentStateProvider({ store, children }: AgentStateProviderProps) {
  return (
    <AgentStoreContext.Provider value={store}>{children}</AgentStoreContext.Provider>
  );
}

/**
 * Internal: read the current AgentStore from context. Throws if no provider
 * is mounted — selector hooks fail loudly when wired up wrong.
 */
export function useAgentStore(): AgentStore {
  const store = useContext(AgentStoreContext);
  if (store === null) {
    throw new Error(
      "[agentui] useAgentNodes / useAgentSelector must be used inside <AgentStateProvider>. " +
        "Wire it up with: const { store } = useAgentStream(...); then wrap children in <AgentStateProvider store={store}>.",
    );
  }
  return store;
}
```

- [ ] **Step 2: Export the provider from `packages/react/src/index.ts`**

After the lines added in Task 1:

```ts
export { createAgentStore } from "./store.js";
export type { AgentStore } from "./store.js";
```

Add:

```ts
export { AgentStateProvider } from "./agent-state-context.js";
export type { AgentStateProviderProps } from "./agent-state-context.js";
```

(Note: `useAgentStore` is intentionally not exported.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kibadist/agentui-react typecheck`
Expected: clean (no errors).

- [ ] **Step 4: Run the full suite — no regressions, but no new tests either**

Run: `pnpm test`
Expected: all existing suites pass. The new provider isn't yet exercised — Task 3 covers it.

- [ ] **Step 5: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/agent-state-context.tsx packages/react/src/index.ts
git commit -m "feat(react): add AgentStateProvider context for store access"
```

---

## Task 3: Selectors — `useAgentSelector` + three convenience hooks + tests

**Files:**
- Create: `packages/react/src/selectors.ts`
- Create: `packages/react/test/selectors.test.tsx`
- Modify: `packages/react/src/index.ts` (export the four hooks)

- [ ] **Step 1: Write the failing tests**

Create `packages/react/test/selectors.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { UIAppendEvent, UIRemoveEvent, UIReplaceEvent, UIToastEvent } from "@kibadist/agentui-protocol";
import {
  AgentStateProvider,
  createAgentStore,
  useAgentNodes,
  useAgentToasts,
  useAgentNavigate,
  useAgentSelector,
  type AgentState,
  type AgentStore,
} from "../src/index.js";

// vitest is configured with `globals: false`, so RTL's auto-cleanup
// doesn't wire itself up automatically. Do it explicitly.
afterEach(cleanup);

function appendEvent(key: string): UIAppendEvent {
  return {
    v: 1,
    id: `evt-a-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.append",
    node: { key, type: "test.node", props: {} },
  };
}

function replaceEvent(key: string, props: Record<string, unknown>): UIReplaceEvent {
  return {
    v: 1,
    id: `evt-r-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.replace",
    key,
    props,
  };
}

function removeEvent(key: string): UIRemoveEvent {
  return {
    v: 1,
    id: `evt-x-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.remove",
    key,
  };
}

function toastEvent(message: string): UIToastEvent {
  return {
    v: 1,
    id: `evt-t-${message}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.toast",
    level: "info",
    message,
  };
}

// Render-counter probes. Each component increments its counter on every render
// and exposes the current value via a data attribute for inspection.
function makeProbe<T>(hook: () => T): {
  Probe: () => JSX.Element;
  renders: () => number;
  lastValue: () => T | undefined;
} {
  let count = 0;
  let last: T | undefined;
  const Probe = () => {
    count++;
    last = hook();
    return <span data-renders={count} />;
  };
  return { Probe, renders: () => count, lastValue: () => last };
}

describe("useAgentNodes / useAgentToasts — re-render boundary", () => {
  it("useAgentNodes does NOT re-render when only a toast arrives", () => {
    const store = createAgentStore();
    const nodes = makeProbe(useAgentNodes);
    const toasts = makeProbe(useAgentToasts);

    render(
      <AgentStateProvider store={store}>
        <nodes.Probe />
        <toasts.Probe />
      </AgentStateProvider>,
    );
    expect(nodes.renders()).toBe(1);
    expect(toasts.renders()).toBe(1);

    act(() => {
      store.send(toastEvent("hello"));
    });

    expect(nodes.renders()).toBe(1);   // unchanged
    expect(toasts.renders()).toBe(2);  // updated
  });
});

describe("useAgentSelector — change detection", () => {
  it("returns a stable value across ui.replace (nodes.length unchanged)", () => {
    const store = createAgentStore();
    const probe = makeProbe(() => useAgentSelector((s: AgentState) => s.nodes.length));

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.renders()).toBe(1);
    expect(probe.lastValue()).toBe(0);

    act(() => {
      store.send(appendEvent("a"));
    });
    expect(probe.renders()).toBe(2);
    expect(probe.lastValue()).toBe(1);

    act(() => {
      store.send(replaceEvent("a", { x: 1 }));
    });
    // length is still 1; probe must not re-render.
    expect(probe.renders()).toBe(2);
    expect(probe.lastValue()).toBe(1);
  });

  it("updates only when the selected key's index changes", () => {
    const store = createAgentStore();
    const probe = makeProbe(() => useAgentSelector((s: AgentState) => s.byKey.get("foo")));

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.renders()).toBe(1);
    expect(probe.lastValue()).toBeUndefined();

    act(() => {
      store.send(appendEvent("a"));   // foo doesn't exist; selector returns undefined → no change
    });
    expect(probe.renders()).toBe(1);

    act(() => {
      store.send(appendEvent("b"));
      store.send(appendEvent("foo"));
    });
    // After two sends foo exists at index 2; probe re-renders once per send.
    // We sent twice so two re-renders are possible — but only the second one
    // changed the selector value. Allow either 2 or 3 renders here.
    const rendersAfterAppends = probe.renders();
    expect(rendersAfterAppends).toBeGreaterThanOrEqual(2);
    expect(probe.lastValue()).toBe(2);

    act(() => {
      store.send(removeEvent("a"));   // shifts foo from 2 → 1
    });
    expect(probe.lastValue()).toBe(1);
    expect(probe.renders()).toBe(rendersAfterAppends + 1);
  });

  it("custom eq is honored (fresh object literal stays stable)", () => {
    const store = createAgentStore();
    const probe = makeProbe(() =>
      useAgentSelector(
        (s: AgentState) => ({ id: s.nodes[0]?.key ?? null }),
        (a, b) => a.id === b.id,
      ),
    );

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.renders()).toBe(1);

    // A toast event does not change s.nodes[0]?.key → custom eq says equal → no re-render.
    act(() => {
      store.send(toastEvent("hi"));
    });
    expect(probe.renders()).toBe(1);

    // An append changes nodes[0].key from null → "a" → eq says not equal → re-render.
    act(() => {
      store.send(appendEvent("a"));
    });
    expect(probe.renders()).toBe(2);
    expect(probe.lastValue()).toEqual({ id: "a" });
  });
});

describe("AgentStateProvider — guardrails", () => {
  it("throws a clear error when a selector hook is used outside the provider", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const probe = makeProbe(useAgentNodes);

    expect(() => render(<probe.Probe />)).toThrow(/AgentStateProvider/);

    errSpy.mockRestore();
  });
});

// Touch-test: useAgentNavigate exists, returns null initially, updates on ui.navigate.
describe("useAgentNavigate — smoke", () => {
  it("returns the latest navigate intent (or null)", () => {
    const store = createAgentStore();
    const probe = makeProbe(useAgentNavigate);

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.lastValue()).toBeNull();

    act(() => {
      store.send({
        v: 1,
        id: "n",
        ts: "2026-01-01T00:00:00Z",
        sessionId: "s1",
        op: "ui.navigate",
        href: "/somewhere",
      });
    });
    expect(probe.lastValue()).toEqual({ href: "/somewhere", replace: undefined });
  });
});
```

- [ ] **Step 2: Run tests, confirm failures**

Run: `pnpm test packages/react/test/selectors.test.tsx`
Expected: all tests fail — selector hooks not yet implemented.

- [ ] **Step 3: Create `packages/react/src/selectors.ts`**

```ts
import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState } from "./reducer.js";

const UNSET: unique symbol = Symbol("agentui:unset");

/**
 * Subscribe to a derived slice of `AgentState`. The selector is re-run on every
 * store notification; the consumer re-renders only when `eq(prev, next)` is
 * false. Default `eq` is `Object.is`.
 */
export function useAgentSelector<T>(
  selector: (state: AgentState) => T,
  eq: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useAgentStore();
  const selRef = useRef(selector);
  selRef.current = selector;
  const eqRef = useRef(eq);
  eqRef.current = eq;
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
}

export const useAgentNodes = () => useAgentSelector((s) => s.nodes);
export const useAgentToasts = () => useAgentSelector((s) => s.toasts);
export const useAgentNavigate = () => useAgentSelector((s) => s.navigate);
```

- [ ] **Step 4: Export from `packages/react/src/index.ts`**

After the lines added in Task 2:

```ts
export { AgentStateProvider } from "./agent-state-context.js";
export type { AgentStateProviderProps } from "./agent-state-context.js";
```

Add:

```ts
export {
  useAgentSelector,
  useAgentNodes,
  useAgentToasts,
  useAgentNavigate,
} from "./selectors.js";
```

- [ ] **Step 5: Typecheck + run the selectors tests**

Run: `pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/selectors.test.tsx`
Expected: typecheck clean, all selector tests pass.

- [ ] **Step 6: Run the full suite — no regressions**

Run: `pnpm test`
Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/selectors.ts packages/react/src/index.ts packages/react/test/selectors.test.tsx
git commit -m "feat(react): add useAgentSelector + useAgentNodes/Toasts/Navigate"
```

---

## Task 4: Refactor `useAgentStream` to use the internal store + expose it

**Files:**
- Modify: `packages/react/src/use-agent-stream.ts` (replace `useReducer` with internal `AgentStore` + `useSyncExternalStore`; expose `store` on return)

The existing `use-agent-stream.test.tsx` suite (4 tests covering `dispatch`, `reset`, the append→reset→append interleave, and the `ui.reset` wire event) must keep passing without modification. The surface `{ state, status, close, reset, dispatch }` is unchanged; we add `store` to it.

- [ ] **Step 1: Replace `packages/react/src/use-agent-stream.ts` entirely**

```ts
import { useEffect, useRef, useCallback, useState, useSyncExternalStore } from "react";
import type { UIEvent } from "@kibadist/agentui-protocol";
import { safeParseUIEvent } from "@kibadist/agentui-validate";
import { createAgentStore, type AgentStore } from "./store.js";
import type { AgentState } from "./reducer.js";

export type StreamStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface UseAgentStreamOptions {
  /** SSE endpoint URL */
  url: string;
  /** Session id (appended as query param) */
  sessionId: string;
  /** Called for every valid UIEvent (after reducer) */
  onEvent?: (event: UIEvent) => void;
  /** Called when an invalid event is received */
  onInvalidEvent?: (raw: unknown, error: Error) => void;
  /** Whether the stream is enabled (default true) */
  enabled?: boolean;
}

export interface UseAgentStreamResult {
  state: AgentState;
  status: StreamStatus;
  /** Close the underlying EventSource (state is preserved). */
  close: () => void;
  /** Clear all UI state (nodes, toasts, navigate). Connection is unaffected. */
  reset: () => void;
  /**
   * Inject a UIEvent into the reducer without going through the wire.
   * Useful for optimistic updates, host-driven UI, and tests.
   */
  dispatch: (event: UIEvent) => void;
  /**
   * The subscribable store backing this stream. Wire into
   * `<AgentStateProvider store={...}>` to enable selector hooks below it.
   */
  store: AgentStore;
}

export function useAgentStream(options: UseAgentStreamOptions): UseAgentStreamResult {
  const { url, sessionId, onEvent, onInvalidEvent, enabled = true } = options;

  // Store is created once per hook instance and stays stable across renders.
  const storeRef = useRef<AgentStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createAgentStore();
  }
  const store = storeRef.current;

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const esRef = useRef<EventSource | null>(null);

  // Stable refs for callbacks
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onInvalidRef = useRef(onInvalidEvent);
  onInvalidRef.current = onInvalidEvent;

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    const separator = url.includes("?") ? "&" : "?";
    const sseUrl = `${url}${separator}sessionId=${encodeURIComponent(sessionId)}`;

    setStatus("connecting");
    const es = new EventSource(sseUrl);
    esRef.current = es;

    es.onopen = () => setStatus("open");

    es.onmessage = (msg) => {
      let raw: unknown;
      try {
        raw = JSON.parse(msg.data);
      } catch {
        return; // ignore non-JSON heartbeats etc.
      }

      const parsed = safeParseUIEvent(raw);
      if (parsed.ok) {
        store.send(parsed.value);
        onEventRef.current?.(parsed.value);
      } else {
        onInvalidRef.current?.(raw, parsed.error);
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStatus("closed");
      } else {
        setStatus("error");
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setStatus("closed");
    };
  }, [url, sessionId, enabled, store]);

  const close = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setStatus("closed");
  }, []);

  const reset = useCallback(() => {
    store.reset();
  }, [store]);

  const publicDispatch = useCallback(
    (event: UIEvent) => {
      store.send(event);
    },
    [store],
  );

  return { state, status, close, reset, dispatch: publicDispatch, store };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kibadist/agentui-react typecheck`
Expected: clean.

- [ ] **Step 3: Run the existing `use-agent-stream` tests — they must keep passing**

Run: `pnpm test packages/react/test/use-agent-stream.test.tsx`
Expected: all 4 tests pass without modification. If any fail, the refactor introduced a behavior change — investigate before continuing.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/use-agent-stream.ts
git commit -m "refactor(react): drive useAgentStream off the new AgentStore + expose store"
```

---

## Task 5: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md` (append to the existing `0.4.0` section, above `0.3.1`)
- Modify: `README.md` (new subsection below the renderer-ergonomics one)

- [ ] **Step 1: Edit `CHANGELOG.md`**

Find the existing `0.4.0` block. The current `### Added — @kibadist/agentui-react` list ends with `AgentRendererProps` exports. Append a second `### Added — @kibadist/agentui-react` group BELOW the existing `### Behavior` group but ABOVE the next `## 0.3.1` heading. Cleaner: place the new content INSIDE the existing `### Added — @kibadist/agentui-react` list and add the new behavior bullets to `### Behavior`.

Concretely, find this line in `CHANGELOG.md`:

```md
- `AgentRendererProps` type is now exported from `@kibadist/agentui-react` for consumers composing on top of the renderer.
```

…and after it, before the blank line that precedes `### Behavior`, insert these new bullets:

```md
- **Granular state selectors.** New hooks: `useAgentNodes()`, `useAgentToasts()`, `useAgentNavigate()`, `useAgentSelector(selector, eq?)`. Consumers using these stop re-rendering on unrelated state changes (e.g., `useAgentNodes()` consumers don't re-render on `ui.toast` / `ui.navigate`).
- **`AgentStateProvider`** context + the `useAgentStream().store` field. Wire as `<AgentStateProvider store={stream.store}>` to enable selector hooks below it.
- **`createAgentStore()`** factory exported for tests and non-stream-driven hosts. Implements `{ getState, subscribe, send, reset }` — a minimal `Subscribable<AgentState>`.
```

Then find this section:

```md
### Behavior

- The internal error boundary only attaches when `errorFallback` is set — no reconciliation overhead for consumers who don't use it.
- `nodeWrapper` is the outermost layer per node; it stays mounted even when the inner component throws and is caught by `errorFallback` (lets `<AnimatePresence>`-style wrappers track keys cleanly).
- Per-node React keys are now placed on an invisible `React.Fragment` for consistency across all wrapper combinations. No DOM impact.
- **Minor:** when a node's type is missing from the registry and a `fallback` is provided, the renderer now returns the fallback content directly. Previously it wrapped the result in a `<span>`. The React key now lives on the outer Fragment, so reconciliation is unchanged — but any CSS or DOM-query that relied on the `<span>` wrapper around fallback output will need to be updated.
```

…and append this bullet at the end of the list (before the next `##` heading):

```md
- `useAgentStream` is now backed internally by an `AgentStore` and `useSyncExternalStore`. The returned `state` field has identical shape and semantics to before; consumers reading `state` directly see no behavior change. Selector hooks are the recommended path for any component that doesn't need the full state object.
```

- [ ] **Step 2: Edit `README.md`**

In `/Users/max/agentui/README.md`, find the existing "Renderer: range, filter, hiddenTypes, errorFallback, nodeWrapper" subsection. After the line:

```md
Composition order is `slot → range → filter → hiddenTypes`. All five default to no-op, so existing call sites need no changes.
```

…and before the next `---` separator, insert this new subsection (preserve a blank line above and below):

```md

### Granular state selectors

`useAgentStream` exposes a subscribable `store`; wire it into `<AgentStateProvider>` and consumers below it can subscribe to derived slices without re-rendering on unrelated events.

```tsx
function App({ url, sessionId }: { url: string; sessionId: string }) {
  const { store, status } = useAgentStream({ url, sessionId });
  return (
    <AgentStateProvider store={store}>
      <Chat />     {/* anywhere inside: useAgentNodes(), useAgentToasts(), ... */}
    </AgentStateProvider>
  );
}

function Chat() {
  const nodes  = useAgentNodes();          // re-renders only when nodes change
  const toasts = useAgentToasts();         // re-renders only when toasts change
  const count  = useAgentSelector((s) => s.nodes.length);  // arbitrary derived state
}
```

For a custom equality function (e.g., to keep a selector ref-stable across notifications):

```tsx
const status = useAgentSelector(
  (s) => ({ id: s.nodes[0]?.key ?? null }),
  (a, b) => a.id === b.id,
);
```

`useAgentStream().state` keeps working — selectors are additive. The detailing-app pattern of splitting "stream-hot" and "session-stable" contexts collapses into a single `<AgentStateProvider>`.
```

- [ ] **Step 3: Run the full suite as a smoke check**

Run: `pnpm test`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/max/agentui
git add CHANGELOG.md README.md
git commit -m "docs: document granular state selectors (0.4.0)"
```

---

## Verification — done when

- [ ] `pnpm test` passes all suites including the new `store.test.ts` (6 tests) and `selectors.test.tsx` (6 tests).
- [ ] `pnpm --filter @kibadist/agentui-react typecheck` is clean.
- [ ] `pnpm --filter @kibadist/agentui-react build` is clean.
- [ ] `git log --oneline` shows the five task commits in order.
- [ ] No version bumps in `package.json` files — release script handles versioning when the user is ready.
- [ ] DET-136 transitioned to "Done" in Linear after the last commit lands.

## Out of scope (restated)

- `<AgentRoot>` lifecycle provider — DET-142 (v0.5).
- Auto-providing the store from `useAgentStream` — explicit wiring stays for now.
- Console.warn on direct `state` access — docs only, no runtime warning path.
- Updating `AgentRuntimeProvider` to also provide `AgentStateProvider` — it's a thin existing layer that v0.5 will subsume; touching it now adds surface that gets replaced.
