---
ticket: DET-150
title: Memory caps + observability hooks
version_target: 0.7.1
date: 2026-05-19
---

# Memory Caps + Observability — Design Spec

## 1. Goal

Two concerns surface at the same place (`<AgentRoot>`):

1. **Memory caps:** bound each reducer slice (`nodes`, `toasts`, `toolCalls`, `reasoning`) to a configured max. Drop-oldest by insertion order. Notify the host once per eviction batch via `onEvict`.
2. **Observability:** emit `onMetric(m)` per measured operation. Names share the `agentui.` namespace. Host-provided `tags` propagate on every metric.

Both are additive — no behavior changes for consumers who don't set the new props.

## 2. API

### 2.1 Caps

```ts
<AgentRoot
  caps={{
    maxNodes: 5000,
    maxToasts: 50,         // currently hardcoded in reducer; expose
    maxToolCalls: 500,
    maxReasoning: 200,
    onEvict: (slice, evicted) => void,
  }}
/>
```

All four `max*` fields optional. Defaults: `maxNodes: Infinity`, `maxToasts: 50` (current behavior), `maxToolCalls: Infinity`, `maxReasoning: Infinity`. Setting any to `Infinity` means "no cap on this slice."

`onEvict(slice, evicted)`:
- `slice: "nodes" | "toasts" | "toolCalls" | "reasoning"`
- `evicted: unknown[]` — the items that were removed, in original insertion order

One callback per batch (debounced via microtask). If two dispatches each evict items from `nodes`, the host sees two callbacks — not one merged.

### 2.2 Observability

```ts
<AgentRoot
  onMetric={(m) => sink(m)}
  tags={{ env: "prod", team: "billing" }}
/>
```

`Metric`:

```ts
export interface Metric {
  name: string;                       // "agentui.event.dispatch_ms" etc.
  value: number;                       // durations in ms; counters: increment count (always 1)
  kind: "timing" | "counter";
  tags: Record<string, string>;        // host tags + builtins (e.g., eventOp, sessionId)
}
```

Emitted metrics (v0.7.1):

| Name | Kind | When |
|---|---|---|
| `agentui.session.create_ms` | timing | session POST → response |
| `agentui.stream.connect_ms` | timing | `connecting` → `open` |
| `agentui.stream.first_event_ms` | timing | `open` → first ingested event |
| `agentui.stream.reconnect_attempts` | counter | each reconnect attempt |
| `agentui.event.parse_ms` | timing | per event (`safeParseAgentEvent` duration) |
| `agentui.event.dispatch_ms` | timing | per event (reducer dispatch + listener notify) |
| `agentui.event.parse_error_count` | counter | each `safeParseAgentEvent` failure |

Tags applied to every metric: host-provided `tags` (passthrough). Plus per-metric:
- All event-scoped metrics include `eventOp` (e.g., `ui.append`)
- All session-scoped metrics include `sessionId` (hashed via FNV-1a, 8 hex chars — not the raw UUID)

## 3. Implementation

### 3.1 Caps — store-level eviction

Caps are passed into `createAgentStore({ caps, onEvict })`. After every successful dispatch, the store checks each slice against its cap; if exceeded, slices the oldest items off, calls `onEvict(slice, evicted)`, and emits one combined state update.

```ts
export interface CapsConfig {
  maxNodes?: number;
  maxToasts?: number;
  maxToolCalls?: number;
  maxReasoning?: number;
  onEvict?: (slice: "nodes" | "toasts" | "toolCalls" | "reasoning", evicted: unknown[]) => void;
}

export function createAgentStore(opts?: { caps?: CapsConfig }): AgentStore;
```

The eviction lives in the store, not the reducer. Reducer stays pure. The existing `MAX_TOASTS = 50` constant becomes `caps.maxToasts ?? 50` at the store boundary.

When evicting `nodes`, the store rebuilds `byKey` to match the new array. When evicting `toolCalls` or `reasoning`, the store removes the same ids from the corresponding `*Order` arrays.

`AgentRoot` passes `caps` to `useAgentStream` which passes to `createAgentStore`.

### 3.2 Observability — metric emitter

A `MetricEmitter` is created at `AgentRoot` level and threaded down via `useAgentStream` and the existing context. Internally, `MetricEmitter` is just:

```ts
interface MetricEmitter {
  timing(name: string, value: number, tags?: Record<string, string>): void;
  counter(name: string, tags?: Record<string, string>): void;
}

function createMetricEmitter(onMetric: ((m: Metric) => void) | undefined, hostTags: Record<string, string>): MetricEmitter;
```

If `onMetric` is undefined, the emitter is a no-op (zero allocations). When defined, every emit produces a `Metric` with `tags` = `{ ...hostTags, ...callerTags }` and calls `onMetric` synchronously.

**Where each metric is emitted:**

| Metric | Site |
|---|---|
| `session.create_ms` | `AgentRoot.create()` and `AgentRoot.resume()` — wrap the fetch |
| `stream.connect_ms` | `useAgentStream` — measure `connecting` start → `onOpen` |
| `stream.first_event_ms` | `useAgentStream` — measure `onOpen` → first `ingest()` |
| `stream.reconnect_attempts` | `useAgentStream` — at `advanceOrGiveUp` increment |
| `event.parse_ms` | `useAgentStream` — wrap `safeParseAgentEvent` |
| `event.dispatch_ms` | `useAgentStream` — wrap `store.send(event)` |
| `event.parse_error_count` | `useAgentStream` — at `onInvalidRef.current?.(...)` site |

### 3.3 Session id hashing

```ts
function hashSessionId(sessionId: string): string {
  // FNV-1a 32-bit, 8 hex chars
  let hash = 2166136261;
  for (let i = 0; i < sessionId.length; i++) {
    hash ^= sessionId.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
```

Pure function. Used for the `sessionId` tag value on session-scoped metrics. Prevents raw UUIDs from landing in metric backends.

## 4. File Layout

```
packages/react/src/
├── store.ts                        # MODIFY — accept caps, evict after dispatch
├── metrics.ts                      # NEW — Metric, MetricEmitter, hashSessionId, no-op fallback
├── use-agent-stream.ts             # MODIFY — accept metrics + caps; emit metrics; wire caps to store
├── agent-root.tsx                  # MODIFY — accept caps + onMetric + tags; thread through
└── index.ts                        # MODIFY — export Metric, CapsConfig

packages/react/test/
├── metrics.test.ts                 # NEW — emitter behavior, hashSessionId
├── store-caps.test.ts              # NEW — eviction + onEvict
└── agent-root-metrics.test.tsx     # NEW — host metrics integration via onMetric spy
```

## 5. Testing

### 5.1 `metrics.test.ts`

- `hashSessionId` is deterministic, 8 hex chars, differs across inputs
- `createMetricEmitter(undefined, {})` is a no-op
- `createMetricEmitter(spy, hostTags)` calls spy with merged tags
- Caller tags override host tags when same key

### 5.2 `store-caps.test.ts`

- Pushing 5001 `ui.append` events with `maxNodes: 5000`: state has 5000 nodes; oldest evicted in order; `onEvict("nodes", [...])` called once per dispatch that exceeds
- Pushing 100 `ui.toast` with `maxToasts: 50`: state has 50 toasts; eviction reported
- `maxToolCalls: 10` with 11 distinct tool calls: oldest evicted from both `toolCalls` Map and `toolCallsOrder` array
- `maxReasoning: 5` with 6 distinct ids: oldest evicted from both `reasoning` Map and `reasoningOrder` array
- Without caps: behavior unchanged (existing 50-toast cap stays)

### 5.3 `agent-root-metrics.test.tsx`

- Mount `<AgentRoot onMetric={spy} tags={{ env: "test" }}>`, simulate session create + 10 events
- Assert: 1 `session.create_ms`, 1 `stream.connect_ms`, 1 `stream.first_event_ms`, 10 `event.parse_ms`, 10 `event.dispatch_ms`
- Every metric has `tags.env === "test"`
- Event metrics have `tags.eventOp` set to the event's `op`
- Session-scoped metrics have `tags.sessionId` matching `hashSessionId(realSessionId)`

## 6. Out of Scope

- Datadog/OTel SDK adapters (consumers wire their own sink to `onMetric`)
- Per-component render-cost metrics
- Custom metric tags from action handlers
- Sampling / aggregation in the library (consumers do this at the sink)
- Memory profiling beyond cap-based eviction

## 7. Acceptance Criteria

- `pnpm test` passes with the three new test files
- Setting `caps={{ maxNodes: 1000 }}` with 1500 events: state stabilizes at 1000 nodes
- A demo `onMetric` callback receives the seven metric names within a normal session
- No metric is emitted when `onMetric` is undefined (timer instrumentation skipped to keep allocations at zero)
