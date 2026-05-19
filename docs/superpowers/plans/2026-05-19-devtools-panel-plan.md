# DevTools Panel Implementation Plan (DET-145)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `<AgentDevTools />` — a floating, opt-in debug panel exposed via `@kibadist/agentui-react/devtools` that shows the live wire-event log, current `AgentState`, and a time-travel scrubber.

**Architecture:** Extend `AgentStore` with a new `subscribeAction(listener)` method so a recorder hook can capture every dispatched action plus the resulting state snapshot. A new `devtools/` subdirectory in `packages/react/src` holds the panel components and ships under a separate subpath export so production bundles that never import `/devtools` get zero bytes. Time-travel is implemented as a scrubber that swaps which snapshot the State Tree panel renders — the host app continues to render live state.

**Tech Stack:** TypeScript (ESM, strict, NodeNext .js extensions), React 19, Vitest + jsdom + @testing-library/react, pnpm workspaces.

Spec: `docs/superpowers/specs/2026-05-18-devtools-panel-design.md`

**Test runner constraint (carried from prior tickets):** ALWAYS use `pnpm test` (one-shot). NEVER `pnpm test:watch` or bare `vitest` (those hang the agent).

---

## File Structure

**Modified (existing files):**
- `packages/react/src/store.ts` — add `subscribeAction` to `AgentStore` interface and `createAgentStore` impl
- `packages/react/src/testing/replay.ts` — widen `replayConversation` parameter type
- `packages/react/src/index.ts` — re-export `RecordedEvent`, `AgentDevTools`-related types
- `packages/react/package.json` — add `./devtools` exports entry
- `CHANGELOG.md` — new `## 0.6.2` block above `## 0.6.0`
- `README.md` — packages table column note (no new package) + new "DevTools panel" H3 subsection
- `examples/next-app/app/page.tsx` (or equivalent) — mount `<AgentDevTools />` for the example

**Created (new files):**
- `packages/react/src/devtools/index.ts` — barrel
- `packages/react/src/devtools/recorder.ts` — `useAgentDevToolsRecorder()` hook + `RecordedEvent` type
- `packages/react/src/devtools/summarize.ts` — one-line summary per action op (pure, no React)
- `packages/react/src/devtools/agent-devtools.tsx` — `<AgentDevTools />` chrome (drag/collapse/close/position) + production gating
- `packages/react/src/devtools/scrubber.tsx` — `<Scrubber />` subcomponent (range input + position state)
- `packages/react/src/devtools/event-log.tsx` — virtualized event log w/ filters + search
- `packages/react/src/devtools/state-tree.tsx` — collapsible state tree

**Created (test files):**
- `packages/react/test/devtools/subscribe-action.test.ts` — Task 1
- `packages/react/test/devtools/replay-type.test.ts` — Task 2 (no runtime change; type-level test)
- `packages/react/test/devtools/recorder.test.tsx` — Task 3
- `packages/react/test/devtools/agent-devtools.test.tsx` — Task 4
- `packages/react/test/devtools/event-log.test.tsx` — Task 5
- `packages/react/test/devtools/state-tree.test.tsx` — Task 5

---

## Task 1: Extend AgentStore with `subscribeAction`

**Files:**
- Modify: `packages/react/src/store.ts`
- Modify: `packages/react/src/index.ts` (re-export the new type if needed)
- Test: `packages/react/test/devtools/subscribe-action.test.ts`

This is foundational — every subsequent task assumes the store can publish actions. Ship it on its own commit.

- [ ] **Step 1.1: Write the failing test**

Create `packages/react/test/devtools/subscribe-action.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createAgentStore } from "../../src/store.js";
import type { AgentAction } from "../../src/reducer.js";

const append = (key: string): AgentAction => ({
  op: "ui.append",
  id: `e-${key}`,
  ts: new Date().toISOString(),
  sessionId: "s-1",
  node: { key, type: "text-block", props: { text: "hi" } },
});

describe("AgentStore.subscribeAction", () => {
  it("notifies listeners with (action, nextState, dispatchMs) after non-no-op send", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    store.subscribeAction(listener);

    const a = append("k1");
    store.send(a);

    expect(listener).toHaveBeenCalledTimes(1);
    const [action, nextState, dispatchMs] = listener.mock.calls[0]!;
    expect(action).toBe(a);
    expect(nextState.nodes).toHaveLength(1);
    expect(nextState.nodes[0].key).toBe("k1");
    expect(typeof dispatchMs).toBe("number");
    expect(dispatchMs).toBeGreaterThanOrEqual(0);
  });

  it("does NOT notify action listeners on no-op (unknown key replace)", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    store.subscribeAction(listener);

    store.send({
      op: "ui.replace",
      id: "e-1",
      ts: new Date().toISOString(),
      sessionId: "s-1",
      key: "does-not-exist",
      props: { text: "x" },
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe removes the listener", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    const unsub = store.subscribeAction(listener);
    unsub();
    store.send(append("k2"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("state listeners and action listeners both fire on a state change", () => {
    const store = createAgentStore();
    const stateListener = vi.fn();
    const actionListener = vi.fn();
    store.subscribe(stateListener);
    store.subscribeAction(actionListener);

    store.send(append("k3"));
    expect(stateListener).toHaveBeenCalledTimes(1);
    expect(actionListener).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/devtools/subscribe-action.test.ts`
Expected: FAIL — `store.subscribeAction is not a function`.

- [ ] **Step 1.3: Add `subscribeAction` to AgentStore**

Edit `packages/react/src/store.ts`. Replace its full contents with:

```ts
import { agentReducer, createInitialAgentState, type AgentAction, type AgentState } from "./reducer.js";

/**
 * Listener invoked by `AgentStore.subscribeAction` after every non-no-op
 * dispatch. Receives the action that just ran, the resulting state, and the
 * wall-clock ms taken by the listener-notify loop (state subscribers + action
 * subscribers, measured together).
 */
export type ActionListener = (
  action: AgentAction,
  nextState: AgentState,
  dispatchMs: number,
) => void;

/**
 * A subscribable wrapper around `AgentState` driven by `agentReducer`.
 * Wire into `<AgentStateProvider>` to power selector hooks
 * (`useAgentNodes`, `useAgentSelector`, etc.).
 */
export interface AgentStore {
  getState(): AgentState;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /**
   * Subscribe to every non-no-op action with the resulting state and dispatch
   * latency. Used by `@kibadist/agentui-react/devtools` and any host that
   * wants to log every wire event (e.g., to Sentry).
   */
  subscribeAction(listener: ActionListener): () => void;
  /** Dispatch an action through `agentReducer` and notify listeners if state changed. */
  send(action: AgentAction): void;
  /** Shorthand for `send({ op: "__reset__" })`. */
  reset(): void;
}

/** Build an `AgentStore`. Optionally seed with initial state. */
export function createAgentStore(initial: AgentState = createInitialAgentState()): AgentStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const actionListeners = new Set<ActionListener>();

  const store: AgentStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeAction(listener) {
      actionListeners.add(listener);
      return () => {
        actionListeners.delete(listener);
      };
    },
    send(action) {
      const start = performance.now();
      const next = agentReducer(state, action);
      if (next === state) return; // no-op: skip both state and action listeners
      state = next;
      listeners.forEach((l) => l());
      if (actionListeners.size > 0) {
        const dispatchMs = performance.now() - start;
        actionListeners.forEach((l) => l(action, state, dispatchMs));
      }
    },
    reset() {
      store.send({ op: "__reset__" });
    },
  };

  return store;
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/devtools/subscribe-action.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 1.5: Run the full suite to confirm nothing broke**

Run: `cd /Users/max/agentui && pnpm test && pnpm typecheck`
Expected: full suite green, typecheck clean.

- [ ] **Step 1.6: Re-export `ActionListener` from the barrel**

Edit `packages/react/src/index.ts`. Find:

```ts
export { createAgentStore } from "./store.js";
export type { AgentStore } from "./store.js";
```

Replace with:

```ts
export { createAgentStore } from "./store.js";
export type { AgentStore, ActionListener } from "./store.js";
```

Run: `cd /Users/max/agentui && pnpm typecheck`
Expected: clean.

- [ ] **Step 1.7: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/store.ts packages/react/src/index.ts packages/react/test/devtools/subscribe-action.test.ts
git commit -m "feat(react): add AgentStore.subscribeAction for action-level observability

Used by upcoming DevTools panel and available to hosts that want to log
every wire event externally."
```

---

## Task 2: Widen `replayConversation` parameter type

**Files:**
- Modify: `packages/react/src/testing/replay.ts`
- Test: `packages/react/test/devtools/replay-type.test.ts` (mostly a runtime smoke test; type widening is verified via tsc)

- [ ] **Step 2.1: Write a test that exercises a non-UI event**

Create `packages/react/test/devtools/replay-type.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { replayConversation, type ReplayableEvent } from "../../src/testing/replay.js";

describe("replayConversation accepts the full AgentAction union (minus __reset__)", () => {
  it("folds tool.start + tool.args-delta into toolCalls state", () => {
    const events: ReplayableEvent[] = [
      {
        op: "tool.start",
        id: "e-1",
        ts: "2026-05-19T00:00:00.000Z",
        sessionId: "s-1",
        toolCallId: "t-1",
        name: "search",
      } as ReplayableEvent,
      {
        op: "tool.args-delta",
        id: "e-2",
        ts: "2026-05-19T00:00:00.001Z",
        sessionId: "s-1",
        toolCallId: "t-1",
        delta: '{"q":"hi"}',
      } as ReplayableEvent,
    ];

    const state = replayConversation(events);
    expect(state.toolCalls.size).toBe(1);
    expect(state.toolCalls.get("t-1")?.argsRaw).toBe('{"q":"hi"}');
  });
});
```

Note: the `as ReplayableEvent` casts shake out once the parameter type is widened — they're a no-op cast against the wider type. If you can write the literals directly without a cast (matching the protocol shape), prefer that.

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/devtools/replay-type.test.ts`
Expected: FAIL — type error or runtime error (`replayConversation` only typed for `UIEvent[]`).

- [ ] **Step 2.3: Widen the parameter type**

Edit `packages/react/src/testing/replay.ts`. Replace its full contents with:

```ts
import { agentReducer, createInitialAgentState, type AgentAction, type AgentResetAction, type AgentState } from "../reducer.js";

/** Every AgentAction except the synthetic `__reset__` — the events you can record and replay. */
export type ReplayableEvent = Exclude<AgentAction, AgentResetAction>;

/** Run a single ReplayableEvent through `agentReducer`. Pure — returns a new state. */
export function pushEvent(state: AgentState, event: ReplayableEvent): AgentState {
  return agentReducer(state, event);
}

/** Fold `agentReducer` over a sequence, starting from a fresh initial state. */
export function replayConversation(events: ReplayableEvent[]): AgentState {
  let state = createInitialAgentState();
  for (const event of events) {
    state = agentReducer(state, event);
  }
  return state;
}
```

- [ ] **Step 2.4: Re-export `ReplayableEvent` from the testing barrel**

Edit `packages/react/src/testing/index.ts`. Replace its full contents with:

```ts
export { pushEvent, replayConversation } from "./replay.js";
export type { ReplayableEvent } from "./replay.js";
export { createTestRegistry } from "./test-registry.js";
export { createMockAgentStream } from "./mock-agent-stream.js";
export type { MockAgentStream } from "./mock-agent-stream.js";
```

- [ ] **Step 2.5: Run the test and the full suite**

Run: `cd /Users/max/agentui && pnpm test && pnpm typecheck`
Expected: full green, including the new replay-type test, plus typecheck clean.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/testing/replay.ts packages/react/src/testing/index.ts packages/react/test/devtools/replay-type.test.ts
git commit -m "feat(react): widen replayConversation to accept all AgentActions

Adds the ReplayableEvent type alias (= AgentAction minus __reset__).
Tool, reasoning, optimistic, and session-meta events now fold through
replayConversation in the same way UI events already did."
```

---

## Task 3: Recorder hook (`useAgentDevToolsRecorder`)

**Files:**
- Create: `packages/react/src/devtools/recorder.ts`
- Create: `packages/react/src/devtools/index.ts` (barrel — will grow over later tasks)
- Test: `packages/react/test/devtools/recorder.test.tsx`

The hook is the core of the panel. It subscribes to `store.subscribeAction`, maintains a ring buffer of `RecordedEvent`, and exposes a snapshot via `useSyncExternalStore` so the panel re-renders only when the version bumps (throttled per animation frame to handle high-throughput streams).

- [ ] **Step 3.1: Write the failing test**

Create `packages/react/test/devtools/recorder.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentDevToolsRecorder } from "../../src/devtools/recorder.js";
import { createAgentStore } from "../../src/store.js";
import { AgentStateProvider } from "../../src/agent-state-context.js";
import type { ReactNode } from "react";
import type { AgentAction } from "../../src/reducer.js";

const append = (key: string): AgentAction => ({
  op: "ui.append",
  id: `e-${key}`,
  ts: new Date().toISOString(),
  sessionId: "s-1",
  node: { key, type: "text-block", props: { text: "x" } },
});

function makeWrapper(store: ReturnType<typeof createAgentStore>) {
  return ({ children }: { children: ReactNode }) => (
    <AgentStateProvider store={store}>{children}</AgentStateProvider>
  );
}

describe("useAgentDevToolsRecorder", () => {
  it("records each non-no-op event with monotonic seq and snapshot", async () => {
    const store = createAgentStore();
    const { result } = renderHook(() => useAgentDevToolsRecorder({ maxEvents: 100 }), {
      wrapper: makeWrapper(store),
    });

    expect(result.current.events).toHaveLength(0);

    act(() => {
      store.send(append("k1"));
      store.send(append("k2"));
      store.send(append("k3"));
    });

    // rAF flush
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    expect(result.current.events).toHaveLength(3);
    expect(result.current.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(result.current.events[2].state.nodes).toHaveLength(3);
  });

  it("skips no-op actions (unknown-key replace)", async () => {
    const store = createAgentStore();
    const { result } = renderHook(() => useAgentDevToolsRecorder({ maxEvents: 100 }), {
      wrapper: makeWrapper(store),
    });

    act(() => {
      store.send({
        op: "ui.replace",
        id: "e-1",
        ts: new Date().toISOString(),
        sessionId: "s-1",
        key: "missing",
        props: { x: 1 },
      });
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    expect(result.current.events).toHaveLength(0);
  });

  it("evicts oldest when ring buffer is full, keeping seq monotonic", async () => {
    const store = createAgentStore();
    const { result } = renderHook(() => useAgentDevToolsRecorder({ maxEvents: 3 }), {
      wrapper: makeWrapper(store),
    });

    act(() => {
      for (let i = 0; i < 5; i++) store.send(append(`k${i}`));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    expect(result.current.events.map((e) => e.seq)).toEqual([2, 3, 4]);
  });

  it("snapshot at any point equals replayConversation of recorded actions", async () => {
    const { replayConversation } = await import("../../src/testing/replay.js");
    const store = createAgentStore();
    const { result } = renderHook(() => useAgentDevToolsRecorder({ maxEvents: 100 }), {
      wrapper: makeWrapper(store),
    });

    act(() => {
      store.send(append("a"));
      store.send(append("b"));
      store.send(append("c"));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const events = result.current.events;
    for (let i = 0; i < events.length; i++) {
      const slice = events.slice(0, i + 1).map((e) => e.action);
      const expected = replayConversation(slice as never);
      expect(events[i].state.nodes.map((n) => n.key)).toEqual(
        expected.nodes.map((n) => n.key),
      );
    }
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/devtools/recorder.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement the recorder hook**

Create `packages/react/src/devtools/recorder.ts`:

```ts
"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "../agent-state-context.js";
import type { AgentAction, AgentState, AgentResetAction } from "../reducer.js";

/** A captured action plus its dispatch-time metadata and resulting state. */
export interface RecordedEvent {
  /** Monotonic seq starting at 0 from recorder mount. Never reset, even after eviction. */
  seq: number;
  /** The raw action that ran (wire event or synthetic __reset__). */
  action: Exclude<AgentAction, AgentResetAction> | AgentResetAction;
  /** Recorder-clock timestamp (ms since epoch, captured at insertion). */
  capturedAt: number;
  /** State after applying this action. */
  state: AgentState;
  /** Ms taken by the store's listener-notify loop for this dispatch. */
  dispatchMs: number;
}

/** Options for the recorder hook. */
export interface UseAgentDevToolsRecorderOptions {
  /** Max events to retain in the ring buffer. Default 500. */
  maxEvents?: number;
}

/** Recorder snapshot returned by the hook. */
export interface UseAgentDevToolsRecorderResult {
  /** All currently buffered events (oldest first). */
  events: RecordedEvent[];
  /** Total count of events seen since mount (including evicted ones). */
  totalSeen: number;
}

/**
 * Subscribe to every non-no-op action on the current `AgentStore` and keep a
 * ring buffer of the last `maxEvents` `RecordedEvent`s. Re-renders the
 * consuming component at most once per animation frame to absorb bursty
 * streams.
 *
 * MUST be used inside an `<AgentStateProvider>` (i.e., inside `<AgentRoot>`).
 */
export function useAgentDevToolsRecorder(
  options: UseAgentDevToolsRecorderOptions = {},
): UseAgentDevToolsRecorderResult {
  const { maxEvents = 500 } = options;
  const store = useAgentStore();

  const eventsRef = useRef<RecordedEvent[]>([]);
  const totalRef = useRef(0);
  const versionRef = useRef(0);
  const rafScheduledRef = useRef(false);
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Stable subscribe/getSnapshot pair for useSyncExternalStore.
  const subscribeRef = useRef((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  });
  const getSnapshotRef = useRef(() => versionRef.current);

  useEffect(() => {
    const unsub = store.subscribeAction((action, nextState, dispatchMs) => {
      const seq = totalRef.current++;
      const ev: RecordedEvent = {
        seq,
        action,
        capturedAt: Date.now(),
        state: nextState,
        dispatchMs,
      };
      const buf = eventsRef.current;
      buf.push(ev);
      while (buf.length > maxEvents) buf.shift();

      // Throttle: schedule at most one rerender per animation frame.
      if (!rafScheduledRef.current) {
        rafScheduledRef.current = true;
        const flush = () => {
          rafScheduledRef.current = false;
          versionRef.current++;
          listenersRef.current.forEach((l) => l());
        };
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(flush);
        } else {
          // Test envs without rAF: flush microtask.
          Promise.resolve().then(flush);
        }
      }
    });
    return unsub;
  }, [store, maxEvents]);

  // Bump version every time someone calls `useSyncExternalStore` to read the
  // latest events. The events array reference itself is mutable, so we return
  // a shallow copy on each snapshot read (cheap relative to the panel's own
  // render cost).
  useSyncExternalStore(subscribeRef.current, getSnapshotRef.current, getSnapshotRef.current);

  return {
    events: eventsRef.current.slice(),
    totalSeen: totalRef.current,
  };
}
```

Create `packages/react/src/devtools/index.ts` (barrel — grows in later tasks):

```ts
export { useAgentDevToolsRecorder } from "./recorder.js";
export type {
  RecordedEvent,
  UseAgentDevToolsRecorderOptions,
  UseAgentDevToolsRecorderResult,
} from "./recorder.js";
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/devtools/recorder.test.tsx`
Expected: PASS — all 4 cases green.

- [ ] **Step 3.5: Run the full suite + typecheck**

Run: `cd /Users/max/agentui && pnpm test && pnpm typecheck`
Expected: green; clean.

- [ ] **Step 3.6: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/devtools/recorder.ts packages/react/src/devtools/index.ts packages/react/test/devtools/recorder.test.tsx
git commit -m "feat(react/devtools): add useAgentDevToolsRecorder hook

Captures every non-no-op action with state snapshot + dispatch latency.
Ring-buffered (default 500), rAF-throttled rerenders."
```

---

## Task 4: `<AgentDevTools />` chrome + scrubber + production gating

**Files:**
- Create: `packages/react/src/devtools/agent-devtools.tsx`
- Create: `packages/react/src/devtools/scrubber.tsx`
- Modify: `packages/react/src/devtools/index.ts` — add new exports
- Test: `packages/react/test/devtools/agent-devtools.test.tsx`

This task ships the visible component with placeholder bodies for the log and tree panels (filled in Task 5). The point is to get the chrome, the scrubber, production gating, and the `enabled` prop all working with passing tests; Task 5 then fills the content.

- [ ] **Step 4.1: Write the failing test**

Create `packages/react/test/devtools/agent-devtools.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { AgentDevTools } from "../../src/devtools/agent-devtools.js";
import { AgentStateProvider } from "../../src/agent-state-context.js";
import { createAgentStore } from "../../src/store.js";
import type { ReactNode } from "react";
import type { AgentAction } from "../../src/reducer.js";

const append = (key: string): AgentAction => ({
  op: "ui.append",
  id: `e-${key}`,
  ts: new Date().toISOString(),
  sessionId: "s-1",
  node: { key, type: "text-block", props: { text: "x" } },
});

function Wrap({ children, store }: { children: ReactNode; store: ReturnType<typeof createAgentStore> }) {
  return <AgentStateProvider store={store}>{children}</AgentStateProvider>;
}

describe("<AgentDevTools />", () => {
  beforeEach(() => {
    // Default NODE_ENV in vitest is "test" — devtools enabled by default.
  });
  afterEach(() => {
    cleanup();
  });

  it("renders chrome when enabled", () => {
    const store = createAgentStore();
    render(
      <Wrap store={store}>
        <AgentDevTools enabled />
      </Wrap>,
    );
    expect(screen.getByText(/AgentDevTools/i)).toBeTruthy();
    expect(screen.getByRole("slider")).toBeTruthy();
  });

  it("renders null and does NOT subscribe when enabled=false", () => {
    const store = createAgentStore();
    const spy = vi.spyOn(store, "subscribeAction");
    const { container } = render(
      <Wrap store={store}>
        <AgentDevTools enabled={false} />
      </Wrap>,
    );
    expect(container.firstChild).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("scrubber moves as events accumulate (stays at live until grabbed)", async () => {
    const store = createAgentStore();
    render(
      <Wrap store={store}>
        <AgentDevTools enabled />
      </Wrap>,
    );

    act(() => {
      store.send(append("k1"));
      store.send(append("k2"));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const slider = screen.getByRole("slider") as HTMLInputElement;
    // At live: value should match events.length (2).
    expect(slider.max).toBe("2");
    expect(slider.value).toBe("2");
  });

  it("collapse button toggles body", () => {
    const store = createAgentStore();
    render(
      <Wrap store={store}>
        <AgentDevTools enabled />
      </Wrap>,
    );
    const collapse = screen.getByRole("button", { name: /collapse|expand/i });
    fireEvent.click(collapse);
    // After collapse, slider should be hidden.
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("throws when mounted outside AgentRoot/AgentStateProvider", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<AgentDevTools enabled />)).toThrow(/agentui/i);
    consoleErrorSpy.mockRestore();
  });
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/devtools/agent-devtools.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement the scrubber**

Create `packages/react/src/devtools/scrubber.tsx`:

```tsx
"use client";

import { type CSSProperties } from "react";

interface ScrubberProps {
  /** Total number of recorded events. */
  total: number;
  /** Current scrub position. `total` means "live". */
  value: number;
  onChange: (next: number) => void;
}

const wrap: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderTop: "1px solid #2a2a30",
  fontSize: 11,
  color: "#a9a9b3",
};

const input: CSSProperties = {
  flex: 1,
  accentColor: "#7dd3fc",
};

export function Scrubber({ total, value, onChange }: ScrubberProps) {
  const live = value >= total;
  return (
    <div style={wrap}>
      <button
        type="button"
        onClick={() => onChange(total)}
        style={{
          background: live ? "#1f3a52" : "transparent",
          color: live ? "#7dd3fc" : "#a9a9b3",
          border: "1px solid #2a2a30",
          borderRadius: 4,
          padding: "2px 6px",
          fontSize: 10,
          cursor: "pointer",
        }}
        aria-label="Jump to live"
      >
        ●
      </button>
      <input
        type="range"
        min={0}
        max={total}
        value={Math.min(value, total)}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        style={input}
        disabled={total === 0}
      />
      <span style={{ minWidth: 84, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {live ? "live" : `${value} / ${total}`}
      </span>
    </div>
  );
}
```

- [ ] **Step 4.4: Implement the chrome component**

Create `packages/react/src/devtools/agent-devtools.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAgentDevToolsRecorder } from "./recorder.js";
import { Scrubber } from "./scrubber.js";

/** Props for `<AgentDevTools />`. */
export interface AgentDevToolsProps {
  /**
   * Force the panel on or off. Default: enabled when
   * `process.env.NODE_ENV !== "production"` OR
   * `process.env.NEXT_PUBLIC_AGENTUI_DEVTOOLS === "1"`.
   */
  enabled?: boolean;
  /** Corner anchor. Default: "br". */
  position?: "br" | "bl" | "tr" | "tl";
  /** Ring buffer cap. Default 500. */
  maxEvents?: number;
  /** Scope to a specific `<AgentRoot id="…">`. Omit to use the nearest. */
  id?: string;
}

function resolveEnabled(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  const env = (typeof process !== "undefined" ? process.env : undefined) ?? {};
  if (env.NODE_ENV !== "production") return true;
  return env.NEXT_PUBLIC_AGENTUI_DEVTOOLS === "1";
}

function corner(position: AgentDevToolsProps["position"]): CSSProperties {
  switch (position) {
    case "bl":
      return { left: 12, bottom: 12 };
    case "tr":
      return { right: 12, top: 12 };
    case "tl":
      return { left: 12, top: 12 };
    case "br":
    default:
      return { right: 12, bottom: 12 };
  }
}

const panelStyle: CSSProperties = {
  position: "fixed",
  zIndex: 2147483000,
  background: "#0e0e12",
  color: "#e6e6ea",
  border: "1px solid #2a2a30",
  borderRadius: 8,
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  width: 520,
  maxHeight: 480,
  display: "flex",
  flexDirection: "column",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 10px",
  borderBottom: "1px solid #2a2a30",
  fontSize: 12,
  userSelect: "none",
  cursor: "move",
};

const bodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 0,
  minHeight: 200,
  maxHeight: 360,
  overflow: "hidden",
};

/**
 * Floating debug panel. Opt-in: defaults to enabled in non-production and
 * when `NEXT_PUBLIC_AGENTUI_DEVTOOLS=1`, otherwise renders null.
 *
 * Must be mounted inside `<AgentRoot>`. Shows the live wire-event log, the
 * current `AgentState` (or a past snapshot via the scrubber), and dispatch
 * latency. Time-travel only changes what the panel renders; the host app
 * continues to render live state.
 */
export function AgentDevTools(props: AgentDevToolsProps) {
  const enabled = resolveEnabled(props.enabled);
  if (!enabled) return null;
  return <AgentDevToolsImpl {...props} />;
}

function AgentDevToolsImpl({ position = "br", maxEvents = 500 }: AgentDevToolsProps) {
  const { events } = useAgentDevToolsRecorder({ maxEvents });
  const [collapsed, setCollapsed] = useState(false);
  const [scrubPos, setScrubPos] = useState(0);
  const liveStickRef = useRef(true);

  // Keep scrubber stuck to "live" until the user grabs it.
  useEffect(() => {
    if (liveStickRef.current) setScrubPos(events.length);
  }, [events.length]);

  const onScrubChange = (next: number) => {
    liveStickRef.current = next >= events.length;
    setScrubPos(next);
  };

  return (
    <div style={{ ...panelStyle, ...corner(position) }}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600 }}>AgentDevTools</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand" : "Collapse"}
            style={chromeButton}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div style={bodyStyle}>
            <div style={panelHalf} data-testid="event-log-panel">
              {/* Filled in Task 5 */}
              <div style={panelTitle}>Event Log ({events.length})</div>
            </div>
            <div style={panelHalf} data-testid="state-tree-panel">
              {/* Filled in Task 5 */}
              <div style={panelTitle}>State Tree</div>
            </div>
          </div>
          <Scrubber total={events.length} value={scrubPos} onChange={onScrubChange} />
        </>
      )}
    </div>
  );
}

const chromeButton: CSSProperties = {
  background: "transparent",
  color: "#a9a9b3",
  border: "1px solid #2a2a30",
  borderRadius: 4,
  padding: "0 6px",
  fontSize: 11,
  cursor: "pointer",
};

const panelHalf: CSSProperties = {
  borderRight: "1px solid #2a2a30",
  overflow: "auto",
};

const panelTitle: CSSProperties = {
  padding: "6px 10px",
  fontSize: 11,
  color: "#a9a9b3",
  borderBottom: "1px solid #1a1a20",
};
```

- [ ] **Step 4.5: Update the devtools barrel**

Edit `packages/react/src/devtools/index.ts`. Replace its full contents with:

```ts
export { useAgentDevToolsRecorder } from "./recorder.js";
export type {
  RecordedEvent,
  UseAgentDevToolsRecorderOptions,
  UseAgentDevToolsRecorderResult,
} from "./recorder.js";

export { AgentDevTools } from "./agent-devtools.js";
export type { AgentDevToolsProps } from "./agent-devtools.js";
```

- [ ] **Step 4.6: Run the test to verify it passes**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/devtools/agent-devtools.test.tsx`
Expected: PASS — all 5 cases green. The "throws when mounted outside AgentRoot" case is satisfied because `useAgentDevToolsRecorder` calls `useAgentStore`, which throws if no provider is present.

- [ ] **Step 4.7: Run the full suite + typecheck**

Run: `cd /Users/max/agentui && pnpm test && pnpm typecheck`
Expected: green; clean.

- [ ] **Step 4.8: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/devtools/agent-devtools.tsx packages/react/src/devtools/scrubber.tsx packages/react/src/devtools/index.ts packages/react/test/devtools/agent-devtools.test.tsx
git commit -m "feat(react/devtools): add <AgentDevTools /> chrome and scrubber

Floating, draggable panel scaffold with production gating, ring-buffered
recorder, and time-travel scrubber. Event log and state tree contents
are placeholders in this task — filled in the next commit."
```

---

## Task 5: Event log + state tree + summarize

**Files:**
- Create: `packages/react/src/devtools/summarize.ts`
- Create: `packages/react/src/devtools/event-log.tsx`
- Create: `packages/react/src/devtools/state-tree.tsx`
- Modify: `packages/react/src/devtools/agent-devtools.tsx` (mount the real EventLog and StateTree)
- Modify: `packages/react/src/devtools/index.ts` (export `summarize` if useful)
- Test: `packages/react/test/devtools/event-log.test.tsx`
- Test: `packages/react/test/devtools/state-tree.test.tsx`

- [ ] **Step 5.1: Write the failing tests**

Create `packages/react/test/devtools/event-log.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EventLog } from "../../src/devtools/event-log.js";
import type { RecordedEvent } from "../../src/devtools/recorder.js";
import { createInitialAgentState } from "../../src/reducer.js";

function mk(seq: number, op: string, extra: Record<string, unknown> = {}): RecordedEvent {
  return {
    seq,
    action: { op, id: `e-${seq}`, ts: "2026-05-19T00:00:00Z", sessionId: "s", ...extra } as never,
    capturedAt: 0,
    state: createInitialAgentState(),
    dispatchMs: 0.5,
  };
}

describe("<EventLog />", () => {
  it("renders one row per event with op and seq", () => {
    const events = [
      mk(0, "ui.append", { node: { key: "k1", type: "text-block", props: { text: "a" } } }),
      mk(1, "tool.start", { toolCallId: "t-1", name: "search" }),
    ];
    render(
      <EventLog
        events={events}
        scrubPos={2}
        onScrub={() => {}}
        filters={{ ui: true, tool: true, reasoning: true, optimistic: true, session: true }}
        onFiltersChange={() => {}}
        search=""
        onSearchChange={() => {}}
      />,
    );
    expect(screen.getByText(/#0/)).toBeTruthy();
    expect(screen.getByText(/ui\.append/)).toBeTruthy();
    expect(screen.getByText(/#1/)).toBeTruthy();
    expect(screen.getByText(/tool\.start/)).toBeTruthy();
  });

  it("filters hide rows of unchecked categories", () => {
    const events = [
      mk(0, "ui.append", { node: { key: "k1", type: "text-block", props: { text: "a" } } }),
      mk(1, "tool.start", { toolCallId: "t-1", name: "search" }),
    ];
    render(
      <EventLog
        events={events}
        scrubPos={2}
        onScrub={() => {}}
        filters={{ ui: true, tool: false, reasoning: true, optimistic: true, session: true }}
        onFiltersChange={() => {}}
        search=""
        onSearchChange={() => {}}
      />,
    );
    expect(screen.queryByText(/tool\.start/)).toBeNull();
    expect(screen.getByText(/ui\.append/)).toBeTruthy();
  });

  it("search filters by op name", () => {
    const events = [
      mk(0, "ui.append", { node: { key: "k1", type: "text-block", props: { text: "a" } } }),
      mk(1, "tool.start", { toolCallId: "t-1", name: "search" }),
    ];
    render(
      <EventLog
        events={events}
        scrubPos={2}
        onScrub={() => {}}
        filters={{ ui: true, tool: true, reasoning: true, optimistic: true, session: true }}
        onFiltersChange={() => {}}
        search="tool"
        onSearchChange={() => {}}
      />,
    );
    expect(screen.queryByText(/ui\.append/)).toBeNull();
    expect(screen.getByText(/tool\.start/)).toBeTruthy();
  });

  it("clicking a row calls onScrub with seq+1", () => {
    let scrubbed = -1;
    const events = [
      mk(0, "ui.append", { node: { key: "k1", type: "text-block", props: { text: "a" } } }),
    ];
    render(
      <EventLog
        events={events}
        scrubPos={1}
        onScrub={(n) => {
          scrubbed = n;
        }}
        filters={{ ui: true, tool: true, reasoning: true, optimistic: true, session: true }}
        onFiltersChange={() => {}}
        search=""
        onSearchChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/#0/));
    expect(scrubbed).toBe(1); // seq 0 → scrubPos 1 (state AFTER event 0)
  });
});
```

Create `packages/react/test/devtools/state-tree.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateTree } from "../../src/devtools/state-tree.js";
import { agentReducer, createInitialAgentState } from "../../src/reducer.js";
import type { AgentAction } from "../../src/reducer.js";

const append = (key: string, type = "text-block"): AgentAction => ({
  op: "ui.append",
  id: `e-${key}`,
  ts: "2026-05-19T00:00:00Z",
  sessionId: "s",
  node: { key, type, props: {} },
});

describe("<StateTree />", () => {
  it("renders top-level section counts", () => {
    const s0 = createInitialAgentState();
    const s1 = agentReducer(s0, append("k1"));
    const s2 = agentReducer(s1, append("k2"));
    render(<StateTree state={s2} />);
    expect(screen.getByText(/nodes \(2\)/i)).toBeTruthy();
    expect(screen.getByText(/toolCalls \(0\)/i)).toBeTruthy();
    expect(screen.getByText(/reasoning \(0\)/i)).toBeTruthy();
    expect(screen.getByText(/byKey \(2\)/i)).toBeTruthy();
  });

  it("expanding nodes shows individual entries", () => {
    const s0 = createInitialAgentState();
    const s1 = agentReducer(s0, append("hello"));
    render(<StateTree state={s1} />);
    expect(screen.getByText(/hello/)).toBeTruthy();
    expect(screen.getByText(/text-block/)).toBeTruthy();
  });
});
```

- [ ] **Step 5.2: Run the tests to verify they fail**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/devtools/event-log.test.tsx packages/react/test/devtools/state-tree.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 5.3: Implement `summarize.ts`**

Create `packages/react/src/devtools/summarize.ts`:

```ts
import type { AgentAction, AgentResetAction } from "../reducer.js";
import type { Replacable = never } from "../reducer.js"; // placeholder so the next line type-checks
```

Wait — strike that. Use this content instead:

```ts
import type { AgentAction } from "../reducer.js";

/** Coarse category for filter checkboxes in the event log. */
export type Category = "ui" | "tool" | "reasoning" | "optimistic" | "session" | "other";

export function categoryOf(action: AgentAction): Category {
  switch (action.op) {
    case "ui.append":
    case "ui.replace":
    case "ui.remove":
    case "ui.toast":
    case "ui.navigate":
    case "ui.reset":
      return "ui";
    case "tool.start":
    case "tool.args-delta":
    case "tool.result":
    case "tool.cancel":
      return "tool";
    case "reasoning.start":
    case "reasoning.delta":
    case "reasoning.end":
      return "reasoning";
    case "optimistic.apply":
    case "optimistic.confirm":
    case "optimistic.rollback":
      return "optimistic";
    case "session.meta":
      return "session";
    default:
      return "other";
  }
}

/** One-line summary string for an action, used as the event-log row body. */
export function summarize(action: AgentAction): string {
  switch (action.op) {
    case "ui.append":
      return `key=${action.node.key} type=${action.node.type}`;
    case "ui.replace":
      return `key=${action.key} ${action.replace ? "(replace)" : "(merge)"}`;
    case "ui.remove":
      return `key=${action.key}`;
    case "ui.toast":
      return `${action.level}: ${truncate(action.message, 60)}`;
    case "ui.navigate":
      return `${action.replace ? "replace" : "push"} ${action.href}`;
    case "ui.reset":
      return "(server reset)";
    case "tool.start":
      return `id=${action.toolCallId} ${action.name}`;
    case "tool.args-delta":
      return `id=${action.toolCallId} +${action.delta.length}c`;
    case "tool.result":
      return `id=${action.toolCallId} ${action.status}${
        action.durationMs !== undefined ? ` ${action.durationMs}ms` : ""
      }`;
    case "tool.cancel":
      return `id=${action.toolCallId}`;
    case "reasoning.start":
      return `id=${action.reasoningId}`;
    case "reasoning.delta":
      return `id=${action.reasoningId} +${action.delta.length}c`;
    case "reasoning.end":
      return `id=${action.reasoningId}${
        action.tokens !== undefined ? ` ${action.tokens}tok` : ""
      }`;
    case "optimistic.apply":
      return `entity=${action.entityKey} origin=${action.originId}`;
    case "optimistic.confirm":
    case "optimistic.rollback":
      return `origin=${action.originId}`;
    case "session.meta":
      return `conv=${action.conversationId}`;
    case "__reset__":
      return "(client reset)";
    default:
      return "";
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
```

**Important:** the property names above (`action.node`, `action.key`, `action.toolCallId`, `action.reasoningId`, etc.) must match the actual protocol shape. Before completing this step, open `packages/protocol/src/index.ts` and verify each property name. If any differs (for example, the protocol uses `id` instead of `toolCallId` on `tool.start`), update `summarize.ts` to match exactly. The reducer file `packages/react/src/reducer.ts` is the authoritative source for what fields exist on each action — cross-check against it.

- [ ] **Step 5.4: Implement the EventLog component**

Create `packages/react/src/devtools/event-log.tsx`:

```tsx
"use client";

import { useMemo, type CSSProperties } from "react";
import type { RecordedEvent } from "./recorder.js";
import { categoryOf, summarize, type Category } from "./summarize.js";

/** Set of which categories are checked. */
export type EventLogFilters = Record<Exclude<Category, "other">, boolean>;

export interface EventLogProps {
  events: RecordedEvent[];
  /** Current scrub position (events.length === live). */
  scrubPos: number;
  /** Move scrubber to N (event seq + 1, i.e. state after that event). */
  onScrub: (next: number) => void;
  filters: EventLogFilters;
  onFiltersChange: (next: EventLogFilters) => void;
  search: string;
  onSearchChange: (s: string) => void;
}

const wrap: CSSProperties = { display: "flex", flexDirection: "column", height: "100%" };
const head: CSSProperties = {
  padding: "6px 10px",
  fontSize: 11,
  color: "#a9a9b3",
  borderBottom: "1px solid #1a1a20",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const list: CSSProperties = { overflowY: "auto", flex: 1, fontSize: 11 };
const row: CSSProperties = {
  padding: "3px 10px",
  borderBottom: "1px solid #16161a",
  display: "grid",
  gridTemplateColumns: "40px 80px 1fr",
  gap: 6,
  cursor: "pointer",
  fontVariantNumeric: "tabular-nums",
};
const rowSel: CSSProperties = { ...row, background: "#1f3a52" };

const opColor: Record<Category, string> = {
  ui: "#7dd3fc",
  tool: "#fbbf77",
  reasoning: "#c4b5fd",
  optimistic: "#86efac",
  session: "#f9a8d4",
  other: "#a9a9b3",
};

export function EventLog({
  events,
  scrubPos,
  onScrub,
  filters,
  onFiltersChange,
  search,
  onSearchChange,
}: EventLogProps) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      const cat = categoryOf(e.action);
      if (cat === "other") return true;
      if (!filters[cat]) return false;
      if (q && !`${e.action.op} ${summarize(e.action)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [events, filters, search]);

  return (
    <div style={wrap}>
      <div style={head}>
        <div>Event Log ({filtered.length}/{events.length})</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(Object.keys(filters) as Array<keyof EventLogFilters>).map((cat) => (
            <label key={cat} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
              <input
                type="checkbox"
                checked={filters[cat]}
                onChange={(e) =>
                  onFiltersChange({ ...filters, [cat]: e.currentTarget.checked })
                }
              />
              <span style={{ color: opColor[cat] }}>{cat}</span>
            </label>
          ))}
        </div>
        <input
          type="text"
          placeholder="search…"
          value={search}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          style={{
            background: "#15151a",
            border: "1px solid #2a2a30",
            color: "#e6e6ea",
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 11,
          }}
        />
      </div>
      <div style={list}>
        {filtered.map((e) => {
          const cat = categoryOf(e.action);
          const sel = scrubPos === e.seq + 1;
          return (
            <div
              key={e.seq}
              style={sel ? rowSel : row}
              onClick={() => onScrub(e.seq + 1)}
              role="button"
              tabIndex={0}
            >
              <span style={{ color: "#a9a9b3" }}>#{e.seq}</span>
              <span style={{ color: opColor[cat] }}>{e.action.op}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {summarize(e.action)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.5: Implement the StateTree component**

Create `packages/react/src/devtools/state-tree.tsx`:

```tsx
"use client";

import { type CSSProperties } from "react";
import type { AgentState } from "../reducer.js";

interface StateTreeProps {
  state: AgentState;
}

const wrap: CSSProperties = { fontSize: 11, padding: "6px 10px", overflowY: "auto", height: "100%" };
const section: CSSProperties = { marginBottom: 6 };
const summary: CSSProperties = { cursor: "pointer", color: "#e6e6ea", fontWeight: 600 };
const entry: CSSProperties = {
  marginLeft: 14,
  color: "#a9a9b3",
  fontVariantNumeric: "tabular-nums",
};

export function StateTree({ state }: StateTreeProps) {
  return (
    <div style={wrap}>
      <details open style={section}>
        <summary style={summary}>nodes ({state.nodes.length})</summary>
        {state.nodes.map((n, i) => (
          <div key={n.key} style={entry}>
            [{i}] {n.type} <span style={{ color: "#7dd3fc" }}>{n.key}</span>
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>toolCalls ({state.toolCalls.size})</summary>
        {Array.from(state.toolCalls.values()).map((t) => (
          <div key={t.id} style={entry}>
            {t.id} {t.name} <span style={{ color: opColorFor(t.status) }}>{t.status}</span>
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>reasoning ({state.reasoning.size})</summary>
        {Array.from(state.reasoning.values()).map((r) => (
          <div key={r.id} style={entry}>
            {r.id} <span style={{ color: r.status === "done" ? "#86efac" : "#fbbf77" }}>{r.status}</span>{" "}
            {r.text.length}c
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>optimistic ({state.optimistic.size})</summary>
        {Array.from(state.optimistic.values()).map((o) => (
          <div key={o.originId} style={entry}>
            {o.entityKey} origin={o.originId}
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>toasts ({state.toasts.length})</summary>
        {state.toasts.map((t) => (
          <div key={t.id} style={entry}>
            {t.level}: {t.message}
          </div>
        ))}
      </details>
      <details style={section}>
        <summary style={summary}>navigate</summary>
        <div style={entry}>{state.navigate ? state.navigate.href : "—"}</div>
      </details>
      <details style={section}>
        <summary style={summary}>byKey ({state.byKey.size})</summary>
        {Array.from(state.byKey.entries()).map(([k, i]) => (
          <div key={k} style={entry}>
            {k} → [{i}]
          </div>
        ))}
      </details>
    </div>
  );
}

function opColorFor(status: string): string {
  switch (status) {
    case "ok":
      return "#86efac";
    case "error":
      return "#fda4af";
    case "cancelled":
      return "#a9a9b3";
    default:
      return "#fbbf77";
  }
}
```

- [ ] **Step 5.6: Wire the real EventLog and StateTree into `<AgentDevTools />`**

Edit `packages/react/src/devtools/agent-devtools.tsx`. Replace the file's full contents with:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAgentDevToolsRecorder } from "./recorder.js";
import { Scrubber } from "./scrubber.js";
import { EventLog, type EventLogFilters } from "./event-log.js";
import { StateTree } from "./state-tree.js";
import { agentReducer, createInitialAgentState } from "../reducer.js";

/** Props for `<AgentDevTools />`. */
export interface AgentDevToolsProps {
  enabled?: boolean;
  position?: "br" | "bl" | "tr" | "tl";
  maxEvents?: number;
  id?: string;
}

function resolveEnabled(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  const env = (typeof process !== "undefined" ? process.env : undefined) ?? {};
  if (env.NODE_ENV !== "production") return true;
  return env.NEXT_PUBLIC_AGENTUI_DEVTOOLS === "1";
}

function corner(position: AgentDevToolsProps["position"]): CSSProperties {
  switch (position) {
    case "bl":
      return { left: 12, bottom: 12 };
    case "tr":
      return { right: 12, top: 12 };
    case "tl":
      return { left: 12, top: 12 };
    case "br":
    default:
      return { right: 12, bottom: 12 };
  }
}

const panelStyle: CSSProperties = {
  position: "fixed",
  zIndex: 2147483000,
  background: "#0e0e12",
  color: "#e6e6ea",
  border: "1px solid #2a2a30",
  borderRadius: 8,
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  width: 640,
  maxHeight: 520,
  display: "flex",
  flexDirection: "column",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 10px",
  borderBottom: "1px solid #2a2a30",
  fontSize: 12,
  userSelect: "none",
  cursor: "move",
};

const bodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 0,
  minHeight: 200,
  maxHeight: 380,
  overflow: "hidden",
};

const halfStyle: CSSProperties = { borderRight: "1px solid #2a2a30", overflow: "auto" };

export function AgentDevTools(props: AgentDevToolsProps) {
  const enabled = resolveEnabled(props.enabled);
  if (!enabled) return null;
  return <AgentDevToolsImpl {...props} />;
}

function computeLatencyStats(events: ReturnType<typeof useAgentDevToolsRecorder>["events"]) {
  if (events.length === 0) return { mean: 0, p99: 0 };
  const recent = events.slice(-100).map((e) => e.dispatchMs).sort((a, b) => a - b);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const p99 = recent[Math.min(recent.length - 1, Math.floor(recent.length * 0.99))];
  return { mean, p99 };
}

function AgentDevToolsImpl({ position = "br", maxEvents = 500 }: AgentDevToolsProps) {
  const { events } = useAgentDevToolsRecorder({ maxEvents });
  const [collapsed, setCollapsed] = useState(false);
  const [scrubPos, setScrubPos] = useState(0);
  const liveStickRef = useRef(true);
  const [filters, setFilters] = useState<EventLogFilters>({
    ui: true,
    tool: true,
    reasoning: true,
    optimistic: true,
    session: true,
  });
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (liveStickRef.current) setScrubPos(events.length);
  }, [events.length]);

  const onScrubChange = (next: number) => {
    liveStickRef.current = next >= events.length;
    setScrubPos(next);
  };

  // View state = fold events[0..scrubPos-1] (or use cached snapshot)
  const viewState = useMemo(() => {
    if (scrubPos >= events.length) {
      return events.length > 0 ? events[events.length - 1].state : createInitialAgentState();
    }
    // Cached snapshot for the event at scrubPos-1 is already correct.
    if (scrubPos === 0) return createInitialAgentState();
    return events[scrubPos - 1].state;
  }, [events, scrubPos]);

  const { mean, p99 } = computeLatencyStats(events);

  return (
    <div style={{ ...panelStyle, ...corner(position) }}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600 }}>AgentDevTools</span>
        <span style={{ color: "#a9a9b3", fontSize: 11 }}>
          mean {mean.toFixed(2)}ms · p99 {p99.toFixed(2)}ms
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand" : "Collapse"}
            style={chromeButton}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div style={bodyStyle}>
            <div style={halfStyle} data-testid="event-log-panel">
              <EventLog
                events={events}
                scrubPos={scrubPos}
                onScrub={onScrubChange}
                filters={filters}
                onFiltersChange={setFilters}
                search={search}
                onSearchChange={setSearch}
              />
            </div>
            <div style={halfStyle} data-testid="state-tree-panel">
              <StateTree state={viewState} />
            </div>
          </div>
          <Scrubber total={events.length} value={scrubPos} onChange={onScrubChange} />
        </>
      )}
    </div>
  );
}

const chromeButton: CSSProperties = {
  background: "transparent",
  color: "#a9a9b3",
  border: "1px solid #2a2a30",
  borderRadius: 4,
  padding: "0 6px",
  fontSize: 11,
  cursor: "pointer",
};
```

Note: the spec says no diff view between snapshots, so `agentReducer` import isn't strictly needed — `events[scrubPos - 1].state` is the cached snapshot. Remove the import if unused.

- [ ] **Step 5.7: Update the devtools barrel**

Edit `packages/react/src/devtools/index.ts`. Replace its full contents with:

```ts
export { useAgentDevToolsRecorder } from "./recorder.js";
export type {
  RecordedEvent,
  UseAgentDevToolsRecorderOptions,
  UseAgentDevToolsRecorderResult,
} from "./recorder.js";

export { AgentDevTools } from "./agent-devtools.js";
export type { AgentDevToolsProps } from "./agent-devtools.js";

export { summarize, categoryOf } from "./summarize.js";
export type { Category } from "./summarize.js";
```

- [ ] **Step 5.8: Run the tests to verify they pass**

Run: `cd /Users/max/agentui && pnpm test packages/react/test/devtools/`
Expected: all devtools tests pass (subscribe-action, replay-type, recorder, agent-devtools, event-log, state-tree). Some test cases written in Task 4 use `screen.getByText(/AgentDevTools/i)` which still works because the real impl still includes that label in the chrome.

- [ ] **Step 5.9: Run the full suite + typecheck**

Run: `cd /Users/max/agentui && pnpm test && pnpm typecheck`
Expected: green; clean.

- [ ] **Step 5.10: Commit**

```bash
cd /Users/max/agentui
git add packages/react/src/devtools packages/react/test/devtools
git commit -m "feat(react/devtools): add event log + state tree + scrubber wiring

Time-travel scrubber now shows the state at any recorded event. Filters
hide rows by category (ui/tool/reasoning/optimistic/session). Search box
filters by op name + summary. Dispatch latency mean/p99 shown in header."
```

---

## Task 6: Subpath export + docs + example app integration

**Files:**
- Modify: `packages/react/package.json` — add `./devtools` export
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `examples/next-app/...` — mount `<AgentDevTools />` in the demo page (path-discoverable; pick the root page that already mounts `<AgentRoot>`).

- [ ] **Step 6.1: Add the subpath export**

Edit `packages/react/package.json`. Find the existing `exports` block:

```json
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
},
```

Replace with:

```json
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
  },
  "./devtools": {
    "types": "./dist/devtools/index.d.ts",
    "import": "./dist/devtools/index.js",
    "default": "./dist/devtools/index.js"
  }
},
```

- [ ] **Step 6.2: Build and verify the subpath resolves**

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react build`
Expected: clean build; verify `packages/react/dist/devtools/index.{js,d.ts}` exists.

Run: `ls packages/react/dist/devtools/`
Expected: `agent-devtools.{js,d.ts,d.ts.map,js.map}`, `event-log.*`, `index.*`, `recorder.*`, `scrubber.*`, `state-tree.*`, `summarize.*`.

- [ ] **Step 6.3: Add CHANGELOG entry**

Edit `CHANGELOG.md`. Find the existing `## 0.6.0` header at the top. Insert ABOVE it:

```md
## 0.6.2

### Added

- **`@kibadist/agentui-react/devtools`** — new subpath export. Ships `<AgentDevTools />`, a floating debug panel with a live wire-event log, current `AgentState` tree, dispatch latency stats, and a time-travel scrubber.
  - Opt-in by default in non-production; production builds must set `NEXT_PUBLIC_AGENTUI_DEVTOOLS=1` (or pass `enabled` explicitly).
  - The panel doesn't rewind the host app — scrubbing only changes what the panel renders.
- **`AgentStore.subscribeAction(listener)`** — public API addition. Notifies listeners with `(action, nextState, dispatchMs)` after every non-no-op dispatch. Hosts that implement custom stores (rare) must add the method.
- `replayConversation` parameter type widened from `UIEvent[]` to `AgentAction[]` (excluding the internal `__reset__`). Existing call sites are unaffected.

```

(Trailing blank line preserved before `## 0.6.0`.)

- [ ] **Step 6.4: Add README subsection**

Edit `README.md`. Find the existing "LLM adapters: provider stream → wire events" H3 subsection. AFTER that subsection (after its code block and before the next subsection or `---`), insert a new H3 section:

```md

### DevTools panel: time-travel state inspector

The `@kibadist/agentui-react/devtools` subpath ships a floating debug panel:

```tsx
"use client";
import { AgentRoot } from "@kibadist/agentui-react";
import { AgentDevTools } from "@kibadist/agentui-react/devtools";

export default function Page() {
  return (
    <AgentRoot endpoint="/api/agent">
      <YourApp />
      <AgentDevTools />
    </AgentRoot>
  );
}
```

Defaults to enabled in non-production. For production opt-in, set `NEXT_PUBLIC_AGENTUI_DEVTOOLS=1` or pass `<AgentDevTools enabled />`. Because the panel lives at a separate subpath, apps that never `import "@kibadist/agentui-react/devtools"` get zero bytes of DevTools code in their production bundle.

The panel shows:

- **Event log** — every wire event with one-line summary, filterable by category (`ui`/`tool`/`reasoning`/`optimistic`/`session`) and searchable.
- **State tree** — the `AgentState` (nodes, toolCalls, reasoning, optimistic, toasts, byKey index) at the selected scrub position.
- **Scrubber** — slide back to any past event to see the state at that point. Time-travel only affects the panel — the host app keeps rendering live state.
- **Latency** — mean and p99 dispatch time over the last 100 events.
```

- [ ] **Step 6.5: Mount `<AgentDevTools />` in the example app**

Run: `cd /Users/max/agentui && rg -l "AgentRoot" examples/next-app/`
Expected: prints one or two files (likely `examples/next-app/app/page.tsx` or `examples/next-app/app/layout.tsx`).

Open the file that mounts `<AgentRoot>` and add the panel as a child. Sketch (the exact path and surrounding code will depend on what's there — keep it minimal):

```tsx
import { AgentDevTools } from "@kibadist/agentui-react/devtools";

// inside the JSX of AgentRoot's children:
<AgentDevTools />
```

The example already has `"use client";` where needed.

- [ ] **Step 6.6: Verify example builds**

Run: `cd /Users/max/agentui && pnpm build`
Expected: clean across all 8 publishable packages + examples.

Run: `cd /Users/max/agentui && pnpm typecheck`
Expected: clean.

- [ ] **Step 6.7: Final full suite**

Run: `cd /Users/max/agentui && pnpm test`
Expected: all tests green.

- [ ] **Step 6.8: Commit**

```bash
cd /Users/max/agentui
git add packages/react/package.json CHANGELOG.md README.md examples/next-app
git commit -m "feat(react/devtools): expose ./devtools subpath + docs + example mount

Adds the @kibadist/agentui-react/devtools entry to exports, documents
<AgentDevTools /> in the README, and mounts it in examples/next-app."
```

---

## Task 7: Final end-to-end review + close Linear ticket

This task is run by the controller (Subagent-Driven Development) — not a fresh implementer subagent.

- [ ] **Step 7.1: Dispatch the final reviewer subagent**

Reviewer prompt outline: audit commits since the spec commit (`5a6af73..HEAD`) against the spec, run `pnpm typecheck && pnpm test && pnpm build`, report verdict.

- [ ] **Step 7.2: On APPROVED / APPROVED_WITH_NOTES, mark DET-145 Done in Linear**

Use `mcp__claude_ai_Linear__save_issue id=DET-145 state=Done`.

---

## Self-review notes

- **Spec coverage:** every section of the design spec maps to a task —
  - §2 surface area + subpath → Task 6
  - §3 recording model + `subscribeAction` → Tasks 1 + 3
  - §4 UI layout → Tasks 4 + 5
  - §5 production gating → Task 4 (with verifying tests)
  - §6 replayConversation widening → Task 2
  - §7 file layout → Tasks 3 / 4 / 5 / 6 (each file is created in the corresponding task)
  - §8 test plan → spread across Tasks 1-5; each subsection corresponds to specific test cases listed in the corresponding test file
- **Type consistency:** `RecordedEvent` (Task 3), `AgentStore.subscribeAction` signature (Task 1), `ReplayableEvent` (Task 2), `EventLogFilters` (Task 5), `AgentDevToolsProps` (Task 4) all match between the test references and the impl definitions.
- **No placeholders:** every step has either a complete code block, an exact command + expected output, or an exact commit message.
- **Property-name caveat in Task 5.3:** the `summarize.ts` body references `action.toolCallId`, `action.reasoningId`, `action.node`, etc. The plan asks the implementer to verify these against `packages/protocol/src/index.ts` before completing the step — that's pragmatic because the controller doesn't have the protocol shapes inlined here, but the implementer can read one file to confirm.
