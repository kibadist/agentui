# Memory Caps + Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `caps`, `onMetric`, and `tags` props to `AgentRoot`. Caps evict from each reducer slice when full. Metrics emit on session create, stream lifecycle, and per-event parse/dispatch durations. Additive — no breaking changes. Targets v0.7.1.

**Architecture:** Caps live at the store layer (after-dispatch eviction). Metrics flow from `AgentRoot` → `useAgentStream` → emitter callback. Reducer remains pure.

**Reference spec:** `docs/superpowers/specs/2026-05-19-memory-caps-observability-design.md`

---

## File Structure

```
packages/react/src/
├── metrics.ts                  # NEW — Metric, MetricEmitter, hashSessionId
├── store.ts                    # MODIFY — accept caps; evict post-dispatch
├── use-agent-stream.ts         # MODIFY — accept metrics + caps; emit + wire
├── agent-root.tsx              # MODIFY — accept caps + onMetric + tags
└── index.ts                    # MODIFY — export new types

packages/react/test/
├── metrics.test.ts             # NEW
├── store-caps.test.ts          # NEW
└── agent-root-metrics.test.tsx # NEW (or augment existing agent-root.test.tsx)
```

---

## Task 1: `metrics.ts` — Metric, MetricEmitter, hashSessionId

**Files:**
- Create: `packages/react/src/metrics.ts`
- Create: `packages/react/test/metrics.test.ts`

- [ ] **Step 1: Write tests in `packages/react/test/metrics.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { createMetricEmitter, hashSessionId, type Metric } from "../src/metrics.js";

describe("hashSessionId", () => {
  it("is deterministic and 8 hex chars", () => {
    const a = hashSessionId("abc");
    const b = hashSessionId("abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs across inputs", () => {
    expect(hashSessionId("a")).not.toBe(hashSessionId("b"));
  });
});

describe("createMetricEmitter", () => {
  it("no-op when onMetric is undefined", () => {
    const emit = createMetricEmitter(undefined, { env: "test" });
    expect(() => emit.timing("foo", 5)).not.toThrow();
    expect(() => emit.counter("bar")).not.toThrow();
  });

  it("calls onMetric with merged tags for timing", () => {
    const spy = vi.fn();
    const emit = createMetricEmitter(spy, { env: "test", region: "us" });
    emit.timing("agentui.event.parse_ms", 1.23, { eventOp: "ui.append" });
    expect(spy).toHaveBeenCalledOnce();
    const m: Metric = spy.mock.calls[0][0];
    expect(m.name).toBe("agentui.event.parse_ms");
    expect(m.value).toBe(1.23);
    expect(m.kind).toBe("timing");
    expect(m.tags).toEqual({ env: "test", region: "us", eventOp: "ui.append" });
  });

  it("calls onMetric with value=1 for counter", () => {
    const spy = vi.fn();
    const emit = createMetricEmitter(spy, {});
    emit.counter("agentui.event.parse_error_count");
    expect(spy.mock.calls[0][0]).toMatchObject({
      name: "agentui.event.parse_error_count",
      value: 1,
      kind: "counter",
    });
  });

  it("caller tags override host tags on conflict", () => {
    const spy = vi.fn();
    const emit = createMetricEmitter(spy, { sessionId: "host" });
    emit.timing("x", 0, { sessionId: "caller" });
    expect(spy.mock.calls[0][0].tags.sessionId).toBe("caller");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/metrics.test.ts
```

- [ ] **Step 3: Implement `packages/react/src/metrics.ts`**

```ts
export interface Metric {
  name: string;
  value: number;
  kind: "timing" | "counter";
  tags: Record<string, string>;
}

export interface MetricEmitter {
  timing(name: string, value: number, tags?: Record<string, string>): void;
  counter(name: string, tags?: Record<string, string>): void;
}

/**
 * Build a metric emitter. If `onMetric` is undefined, returns a no-op
 * emitter with zero allocations per call.
 */
export function createMetricEmitter(
  onMetric: ((m: Metric) => void) | undefined,
  hostTags: Record<string, string>,
): MetricEmitter {
  if (onMetric === undefined) {
    return NOOP_EMITTER;
  }
  return {
    timing(name, value, tags) {
      onMetric({
        name,
        value,
        kind: "timing",
        tags: tags ? { ...hostTags, ...tags } : { ...hostTags },
      });
    },
    counter(name, tags) {
      onMetric({
        name,
        value: 1,
        kind: "counter",
        tags: tags ? { ...hostTags, ...tags } : { ...hostTags },
      });
    },
  };
}

const NOOP_EMITTER: MetricEmitter = {
  timing() {},
  counter() {},
};

/**
 * FNV-1a 32-bit hash, lowercase 8 hex chars. Used to anonymize sessionId
 * before tagging metrics.
 */
export function hashSessionId(sessionId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < sessionId.length; i++) {
    hash ^= sessionId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Verify typecheck**

- [ ] **Step 6: Commit**

```
git add packages/react/src/metrics.ts packages/react/test/metrics.test.ts
git commit -m "feat(react): Metric, MetricEmitter, hashSessionId"
```

---

## Task 2: Store caps + post-dispatch eviction

**Files:**
- Modify: `packages/react/src/store.ts`
- Create: `packages/react/test/store-caps.test.ts`

- [ ] **Step 1: Read current store.ts to confirm structure**

`createAgentStore()` currently takes no options. It owns `state`, applies the reducer in `send`, notifies listeners. After eviction, it must:
1. Apply the cap to each slice
2. Call `onEvict(slice, evicted)` for any slice that had items removed
3. Notify listeners

- [ ] **Step 2: Write tests in `packages/react/test/store-caps.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { createAgentStore } from "../src/store.js";
import type { AgentAction } from "../src/reducer.js";

function appendNode(key: string): AgentAction {
  return {
    op: "ui.append",
    id: `e-${key}`,
    ts: new Date().toISOString(),
    sessionId: "s",
    node: { key, type: "text-block", props: { text: key } },
  };
}

function toast(id: string): AgentAction {
  return {
    op: "ui.toast",
    id,
    ts: new Date().toISOString(),
    sessionId: "s",
    level: "info",
    message: `m-${id}`,
  };
}

function toolStart(callId: string): AgentAction {
  return {
    op: "tool.call.start",
    id: `e-${callId}`,
    ts: new Date().toISOString(),
    sessionId: "s",
    callId,
    name: "noop",
  };
}

function reasoningStart(rid: string): AgentAction {
  return {
    op: "reasoning.start",
    id: `e-${rid}`,
    ts: new Date().toISOString(),
    sessionId: "s",
    reasoningId: rid,
  };
}

describe("createAgentStore — caps", () => {
  it("evicts oldest nodes when maxNodes exceeded", () => {
    const onEvict = vi.fn();
    const store = createAgentStore({ caps: { maxNodes: 3, onEvict } });
    for (let i = 0; i < 5; i++) store.send(appendNode(`n${i}`));
    expect(store.getState().nodes.length).toBe(3);
    expect(store.getState().nodes.map((n) => n.key)).toEqual(["n2", "n3", "n4"]);
    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(onEvict.mock.calls[0]).toEqual(["nodes", [expect.objectContaining({ key: "n0" })]]);
  });

  it("evicts oldest toasts when maxToasts exceeded", () => {
    const onEvict = vi.fn();
    const store = createAgentStore({ caps: { maxToasts: 2, onEvict } });
    for (let i = 0; i < 5; i++) store.send(toast(`t${i}`));
    expect(store.getState().toasts.length).toBe(2);
    expect(onEvict).toHaveBeenCalledTimes(3);
  });

  it("evicts oldest tool calls when maxToolCalls exceeded", () => {
    const onEvict = vi.fn();
    const store = createAgentStore({ caps: { maxToolCalls: 2, onEvict } });
    for (let i = 0; i < 4; i++) store.send(toolStart(`tc${i}`));
    const s = store.getState();
    expect(s.toolCalls.size).toBe(2);
    expect(s.toolCallsOrder).toEqual(["tc2", "tc3"]);
    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(onEvict.mock.calls[0][0]).toBe("toolCalls");
  });

  it("evicts oldest reasoning segments when maxReasoning exceeded", () => {
    const onEvict = vi.fn();
    const store = createAgentStore({ caps: { maxReasoning: 2, onEvict } });
    for (let i = 0; i < 4; i++) store.send(reasoningStart(`r${i}`));
    const s = store.getState();
    expect(s.reasoning.size).toBe(2);
    expect(s.reasoningOrder).toEqual(["r2", "r3"]);
    expect(onEvict).toHaveBeenCalledTimes(2);
  });

  it("preserves existing 50-toast default when caps unset", () => {
    const store = createAgentStore();
    for (let i = 0; i < 60; i++) store.send(toast(`t${i}`));
    expect(store.getState().toasts.length).toBe(50);
  });

  it("rebuilds byKey after node eviction", () => {
    const store = createAgentStore({ caps: { maxNodes: 2 } });
    store.send(appendNode("a"));
    store.send(appendNode("b"));
    store.send(appendNode("c"));
    const s = store.getState();
    expect(s.byKey.get("a")).toBeUndefined();
    expect(s.byKey.get("b")).toBe(0);
    expect(s.byKey.get("c")).toBe(1);
  });

  it("no eviction when caps undefined or Infinity", () => {
    const store = createAgentStore({ caps: { maxNodes: Infinity } });
    for (let i = 0; i < 1000; i++) store.send(appendNode(`n${i}`));
    expect(store.getState().nodes.length).toBe(1000);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/store-caps.test.ts
```

- [ ] **Step 4: Read current `packages/react/src/store.ts`**

Confirm the structure (`createAgentStore()` returns `{ getState, send, subscribe, subscribeAction, reset }`).

- [ ] **Step 5: Modify `createAgentStore` to accept `CapsConfig`**

Add to the top of the file:

```ts
export type EvictableSlice = "nodes" | "toasts" | "toolCalls" | "reasoning";

export interface CapsConfig {
  maxNodes?: number;
  maxToasts?: number;
  maxToolCalls?: number;
  maxReasoning?: number;
  onEvict?: (slice: EvictableSlice, evicted: unknown[]) => void;
}

export interface CreateAgentStoreOptions {
  caps?: CapsConfig;
}
```

Change the signature:

```ts
export function createAgentStore(options?: CreateAgentStoreOptions): AgentStore {
  const caps = options?.caps;
  // ...existing state init...

  function applyEviction(prev: AgentState): AgentState {
    if (!caps) return prev;
    let state = prev;
    const onEvict = caps.onEvict;

    const maxNodes = caps.maxNodes ?? Infinity;
    if (state.nodes.length > maxNodes) {
      const evictCount = state.nodes.length - maxNodes;
      const evicted = state.nodes.slice(0, evictCount);
      const nodes = state.nodes.slice(evictCount);
      const byKey = new Map<string, number>();
      for (let i = 0; i < nodes.length; i++) byKey.set(nodes[i].key, i);
      state = { ...state, nodes, byKey };
      onEvict?.("nodes", evicted);
    }

    const maxToasts = caps.maxToasts ?? Infinity;
    if (state.toasts.length > maxToasts) {
      const evicted = state.toasts.slice(0, state.toasts.length - maxToasts);
      state = { ...state, toasts: state.toasts.slice(-maxToasts) };
      onEvict?.("toasts", evicted);
    }

    const maxToolCalls = caps.maxToolCalls ?? Infinity;
    if (state.toolCallsOrder.length > maxToolCalls) {
      const evictCount = state.toolCallsOrder.length - maxToolCalls;
      const evictedIds = state.toolCallsOrder.slice(0, evictCount);
      const newOrder = state.toolCallsOrder.slice(evictCount);
      const newMap = new Map(state.toolCalls);
      const evictedItems: unknown[] = [];
      for (const id of evictedIds) {
        const item = newMap.get(id);
        if (item !== undefined) evictedItems.push(item);
        newMap.delete(id);
      }
      state = { ...state, toolCalls: newMap, toolCallsOrder: newOrder };
      onEvict?.("toolCalls", evictedItems);
    }

    const maxReasoning = caps.maxReasoning ?? Infinity;
    if (state.reasoningOrder.length > maxReasoning) {
      const evictCount = state.reasoningOrder.length - maxReasoning;
      const evictedIds = state.reasoningOrder.slice(0, evictCount);
      const newOrder = state.reasoningOrder.slice(evictCount);
      const newMap = new Map(state.reasoning);
      const evictedItems: unknown[] = [];
      for (const id of evictedIds) {
        const item = newMap.get(id);
        if (item !== undefined) evictedItems.push(item);
        newMap.delete(id);
      }
      state = { ...state, reasoning: newMap, reasoningOrder: newOrder };
      onEvict?.("reasoning", evictedItems);
    }

    return state;
  }
```

After the reducer applies in `send()`, call `applyEviction(newState)` before notifying listeners. The existing `MAX_TOASTS = 50` constant in `reducer.ts` should be DELETED or set to `Infinity`, because the cap now lives at the store. **However**, to preserve the existing 50-toast default, the store applies `caps?.maxToasts ?? 50` (note: 50, not Infinity).

Wait — actually keep the reducer's 50-toast slice cleaner. Solution: leave the reducer's `MAX_TOASTS = 50` slice in place (it's still a defensive trim). When `caps.maxToasts` is set, the store applies a stricter cap on top of it. When not set, the reducer's 50 stays in effect. This means `applyEviction` only applies `caps.maxToasts` when explicitly set — defaults handled by reducer.

Adjust the maxToasts branch above:

```ts
if (caps.maxToasts !== undefined && state.toasts.length > caps.maxToasts) {
  const evicted = state.toasts.slice(0, state.toasts.length - caps.maxToasts);
  state = { ...state, toasts: state.toasts.slice(-caps.maxToasts) };
  onEvict?.("toasts", evicted);
}
```

Other branches use `?? Infinity` — but `if (state.* > Infinity)` is always false, so eviction is skipped. Effectively only-when-set.

- [ ] **Step 6: Run tests — expect PASS**

- [ ] **Step 7: Run full react suite to catch regressions**

```
pnpm --filter @kibadist/agentui-react exec vitest run
```

- [ ] **Step 8: Verify typecheck**

- [ ] **Step 9: Commit**

```
git add packages/react/src/store.ts packages/react/test/store-caps.test.ts
git commit -m "feat(react): store-level memory caps with onEvict per slice"
```

---

## Task 3: Wire metrics + caps into `useAgentStream`

**Files:**
- Modify: `packages/react/src/use-agent-stream.ts`

- [ ] **Step 1: Add `metrics` and `caps` to UseAgentStreamOptions**

In the interface block, add:

```ts
import type { CapsConfig } from "./store.js";
import type { MetricEmitter } from "./metrics.js";

export interface UseAgentStreamOptions {
  url: string;
  sessionId: string;
  onEvent?: (event: AgentWireEvent) => void;
  onInvalidEvent?: (raw: unknown, error: Error) => void;
  enabled?: boolean;
  retry?: RetryConfig;
  buffer?: BufferConfig;
  auth?: AuthConfig;
  caps?: CapsConfig;        // NEW
  metrics?: MetricEmitter;   // NEW
}
```

- [ ] **Step 2: Use caps when creating the store**

Change the `useRef` block where store is created:

```ts
const storeRef = useRef<AgentStore | null>(null);
if (storeRef.current === null) {
  storeRef.current = createAgentStore({ caps });
}
const store = storeRef.current;
```

Note: caps are captured at first render. Changing `caps` after mount won't propagate. Document this as a known limitation; consumers needing dynamic caps can remount.

- [ ] **Step 3: Hold metrics in a ref**

```ts
const metricsRef = useRef(metrics);
metricsRef.current = metrics;
```

- [ ] **Step 4: Instrument the connect/event lifecycle**

Inside `attemptConnect`, before calling `connectSse`:

```ts
const connectStartMs = performance.now();
let firstEventEmitted = false;
```

In the `onOpen` callback:

```ts
onOpen: () => {
  attempt = 0;
  setStatus("open");
  metricsRef.current?.timing(
    "agentui.stream.connect_ms",
    performance.now() - connectStartMs,
    { sessionId: hashSessionId(sessionId) },
  );
},
```

In the `onEvent` callback, wrap parsing and dispatching:

```ts
onEvent: (raw, id) => {
  if (id !== undefined) lastEventId = id;
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(raw);
  } catch {
    return;
  }

  const parseStart = performance.now();
  const result = safeParseAgentEvent(parsedRaw);
  metricsRef.current?.timing(
    "agentui.event.parse_ms",
    performance.now() - parseStart,
    { eventOp: (parsedRaw as { op?: string }).op ?? "unknown" },
  );

  if (result.ok) {
    if (!firstEventEmitted) {
      firstEventEmitted = true;
      metricsRef.current?.timing(
        "agentui.stream.first_event_ms",
        performance.now() - connectStartMs,
        { sessionId: hashSessionId(sessionId) },
      );
    }
    const dispatchStart = performance.now();
    ingest(result.value);
    metricsRef.current?.timing(
      "agentui.event.dispatch_ms",
      performance.now() - dispatchStart,
      { eventOp: result.value.op },
    );
  } else {
    metricsRef.current?.counter("agentui.event.parse_error_count");
    onInvalidRef.current?.(parsedRaw, result.error);
  }
},
```

In `advanceOrGiveUp`, count reconnects:

```ts
async function advanceOrGiveUp(err: Error): Promise<boolean> {
  attempt++;
  metricsRef.current?.counter("agentui.stream.reconnect_attempts");
  // ...rest unchanged
}
```

Add the import for `hashSessionId`:

```ts
import { hashSessionId } from "./metrics.js";
```

- [ ] **Step 5: Verify build + existing tests still pass**

```
pnpm --filter @kibadist/agentui-react build
pnpm --filter @kibadist/agentui-react exec vitest run
```

Expected: no test regressions. Existing resilience tests don't set `metrics` so the emitter is undefined — instrumentation is a no-op.

- [ ] **Step 6: Verify typecheck**

- [ ] **Step 7: Commit**

```
git add packages/react/src/use-agent-stream.ts
git commit -m "feat(react): useAgentStream emits metrics + threads caps to store"
```

---

## Task 4: Wire `caps`, `onMetric`, `tags` into `AgentRoot`

**Files:**
- Modify: `packages/react/src/agent-root.tsx`
- Create: `packages/react/test/agent-root-metrics.test.tsx`

- [ ] **Step 1: Read current AgentRoot props block**

Currently:

```ts
export interface AgentRootProps {
  endpoint: string;
  storage?: SessionStorageAdapter;
  fetch?: typeof fetch;
  autoConnect?: boolean;
  onError?: (err: AgentError) => void;
  id?: string;
  children: ReactNode;
}
```

- [ ] **Step 2: Add three new optional props**

```ts
import type { CapsConfig } from "./store.js";
import type { Metric } from "./metrics.js";
import { createMetricEmitter, hashSessionId } from "./metrics.js";

export interface AgentRootProps {
  endpoint: string;
  storage?: SessionStorageAdapter;
  fetch?: typeof fetch;
  autoConnect?: boolean;
  onError?: (err: AgentError) => void;
  id?: string;
  children: ReactNode;
  /** Per-slice memory caps with drop-oldest eviction. */
  caps?: CapsConfig;
  /** Receives every emitted metric. */
  onMetric?: (m: Metric) => void;
  /** Tags applied to every metric. */
  tags?: Record<string, string>;
}
```

- [ ] **Step 3: Build the emitter and pass to useAgentStream**

Inside the component body, after `const endpoint = ...`:

```ts
const metricsEmitter = useMemo(
  () => createMetricEmitter(onMetric, tags ?? {}),
  [onMetric, tags],
);
```

Change the `useAgentStream` call:

```ts
const stream = useAgentStream({
  url: `${endpoint}/stream`,
  sessionId: sessionId ?? "",
  enabled: sessionId !== null,
  onEvent: handleEvent,
  caps,
  metrics: metricsEmitter,
});
```

- [ ] **Step 4: Instrument `create()` and `resume()`**

Inside `create`, wrap the fetch:

```ts
const startMs = performance.now();
try {
  const res = await doFetch(`${endpoint}/session`, { method: "POST" });
  // ...existing code...
  const data = (await res.json()) as { sessionId: string };
  if (seq !== seqRef.current) return;
  setSessionId(data.sessionId);
  metricsEmitter.timing(
    "agentui.session.create_ms",
    performance.now() - startMs,
    { sessionId: hashSessionId(data.sessionId) },
  );
}
```

Same pattern in `resume()`.

- [ ] **Step 5: Write integration test in `packages/react/test/agent-root-metrics.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { AgentRoot } from "../src/agent-root.js";
import * as sseModule from "../src/sse-transport.js";

let connectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  connectSpy = vi.spyOn(sseModule, "connectSse").mockImplementation(async (opts) => {
    opts.onOpen();
    opts.onEvent(
      JSON.stringify({
        v: 1,
        id: "e1",
        ts: new Date().toISOString(),
        sessionId: "s",
        op: "ui.append",
        node: { key: "n1", type: "text-block", props: { text: "x" } },
      }),
      "e1",
    );
    await new Promise<void>((r) => opts.signal.addEventListener("abort", () => r()));
  });

  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sessionId: "real-uuid-abc" }), { status: 200 }),
  );
});

afterEach(() => {
  cleanup();
  connectSpy.mockRestore();
});

describe("AgentRoot — onMetric integration", () => {
  it("emits session.create_ms, stream.connect_ms, first_event_ms, parse_ms, dispatch_ms", async () => {
    const onMetric = vi.fn();
    render(
      <AgentRoot endpoint="http://x" onMetric={onMetric} tags={{ env: "test" }}>
        <div>child</div>
      </AgentRoot>,
    );

    await waitFor(() => {
      const names = onMetric.mock.calls.map((c) => c[0].name);
      expect(names).toContain("agentui.session.create_ms");
      expect(names).toContain("agentui.stream.connect_ms");
      expect(names).toContain("agentui.stream.first_event_ms");
      expect(names).toContain("agentui.event.parse_ms");
      expect(names).toContain("agentui.event.dispatch_ms");
    });
  });

  it("applies host tags to every metric", async () => {
    const onMetric = vi.fn();
    render(
      <AgentRoot endpoint="http://x" onMetric={onMetric} tags={{ env: "test" }}>
        <div>child</div>
      </AgentRoot>,
    );

    await waitFor(() => {
      expect(onMetric.mock.calls.length).toBeGreaterThan(0);
    });

    for (const [m] of onMetric.mock.calls) {
      expect(m.tags.env).toBe("test");
    }
  });

  it("event metrics include eventOp; session metrics include hashed sessionId", async () => {
    const onMetric = vi.fn();
    render(
      <AgentRoot endpoint="http://x" onMetric={onMetric}>
        <div>child</div>
      </AgentRoot>,
    );

    await waitFor(() => {
      const eventMetrics = onMetric.mock.calls.filter((c) => c[0].name.startsWith("agentui.event."));
      expect(eventMetrics.length).toBeGreaterThan(0);
      for (const [m] of eventMetrics) {
        expect(m.tags.eventOp).toBeDefined();
      }
      const sessionMetrics = onMetric.mock.calls.filter((c) => c[0].name === "agentui.session.create_ms");
      expect(sessionMetrics.length).toBe(1);
      expect(sessionMetrics[0][0].tags.sessionId).toMatch(/^[0-9a-f]{8}$/);
    });
  });
});
```

- [ ] **Step 6: Run new test**

```
pnpm --filter @kibadist/agentui-react exec vitest run test/agent-root-metrics.test.tsx
```

- [ ] **Step 7: Run full react suite**

```
pnpm --filter @kibadist/agentui-react exec vitest run
```

- [ ] **Step 8: Verify typecheck + build**

- [ ] **Step 9: Commit**

```
git add packages/react/src/agent-root.tsx packages/react/test/agent-root-metrics.test.tsx
git commit -m "feat(react): AgentRoot accepts caps + onMetric + tags"
```

---

## Task 5: Barrel exports

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Add new type exports**

Find the existing `export type` blocks. Add (anywhere logical — group with related types):

```ts
export type { Metric, MetricEmitter } from "./metrics.js";
export type { CapsConfig, EvictableSlice } from "./store.js";
```

- [ ] **Step 2: Verify build + typecheck**

```
pnpm --filter @kibadist/agentui-react build
pnpm typecheck
```

- [ ] **Step 3: Commit**

```
git add packages/react/src/index.ts
git commit -m "feat(react): export Metric, CapsConfig, EvictableSlice types"
```

---

## Task 6: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Add `## 0.7.1` block above `## 0.7.0` in CHANGELOG.md**

```markdown
## 0.7.1

### Added
- `<AgentRoot caps={{ maxNodes, maxToasts, maxToolCalls, maxReasoning, onEvict }}>` — per-slice memory caps with drop-oldest eviction. `onEvict(slice, evicted)` fires once per dispatch that exceeds a cap.
- `<AgentRoot onMetric={...} tags={...}>` — observability hooks. Seven metrics in the `agentui.*` namespace cover session lifecycle, stream lifecycle, and per-event parse/dispatch durations. Host-provided `tags` propagate on every metric.
- New types: `Metric`, `MetricEmitter`, `CapsConfig`, `EvictableSlice` re-exported from `@kibadist/agentui-react`.

### Notes
- Metrics emit synchronously and are no-op when `onMetric` is unset (zero allocations).
- Caps apply only when explicitly set; the default 50-toast trim remains in place.
- Session ids are FNV-1a hashed (8 hex chars) before landing in metric tags; raw UUIDs are never tagged.
```

- [ ] **Step 2: Add "Memory caps + metrics" subsection to README.md after "Stream resilience"**

```markdown
### Memory caps + metrics

Bound per-slice memory and observe runtime behavior:

```ts
<AgentRoot
  endpoint="..."
  caps={{
    maxNodes: 5000,
    maxToolCalls: 500,
    onEvict: (slice, evicted) => console.log(`evicted ${evicted.length} from ${slice}`),
  }}
  onMetric={(m) => sink.record(m)}
  tags={{ env: "prod" }}
>
  …
</AgentRoot>
```

Emitted metrics (all timings in ms):

| Name | Kind |
|---|---|
| `agentui.session.create_ms` | timing |
| `agentui.stream.connect_ms` | timing |
| `agentui.stream.first_event_ms` | timing |
| `agentui.stream.reconnect_attempts` | counter |
| `agentui.event.parse_ms` | timing |
| `agentui.event.dispatch_ms` | timing |
| `agentui.event.parse_error_count` | counter |

`sessionId` tags are FNV-1a hashed; raw UUIDs never leave the library.
```

Use real triple-backticks in the file.

- [ ] **Step 3: Verify all checks**

```
pnpm typecheck && pnpm test && pnpm build
```

- [ ] **Step 4: Commit**

```
git add CHANGELOG.md README.md
git commit -m "docs(react): CHANGELOG 0.7.1 + README memory caps + metrics section"
```

---

## Self-Review

Spec coverage:
- §2.1 caps API → Task 2 (store), Task 4 (AgentRoot prop)
- §2.2 observability API → Task 4 (AgentRoot prop)
- §3.1 store-level eviction → Task 2
- §3.2 metric emitter sites → Task 3 (useAgentStream), Task 4 (AgentRoot.create/resume)
- §3.3 hashSessionId → Task 1
- §5 testing → distributed across all tasks
- §6 out of scope → no tasks (intentional)

Identifier consistency:
- `CapsConfig`, `EvictableSlice`, `CreateAgentStoreOptions` — Task 2
- `Metric`, `MetricEmitter`, `createMetricEmitter`, `hashSessionId` — Task 1
- Wiring chain: `AgentRoot.onMetric` → `createMetricEmitter` → `useAgentStream.metrics` → emit sites
