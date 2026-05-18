# Tool-call protocol + reducer slice + selectors (DET-139 / v0.5.1)

Linear: [DET-139 — v0.5 — Tool-call protocol + reducer slice + selectors](https://linear.app/detailing-app/issue/DET-139)

## Goal

Ship a typed, end-to-end tool-call surface that every streaming-LLM consumer otherwise reinvents: a pill that says "Calling `search_clients`…", spinner, args streaming preview, result/error state. Servers and clients agree on shape via 4 new wire events; the React side adds a state slice, two selector hooks, and a headless `<ToolCallStream>` primitive.

## Non-goals (deliberate)

- Streaming tool results (`partial: true` on `tool.result`). Defer to v0.6.
- Retry / replay semantics. Surface left to hosts.
- Tool-specific visual primitives (pills, spinners, status icons). `<ToolCallStream>` is headless by design.
- `traceId` UX (grouping a chain of tool calls by trace). Wire field already exists; library-level grouping not yet justified.
- Logging rejected state transitions via `onInvalidEvent`. Discussed below — silent reducer no-op instead.

## Architecture

```
Server (LLM agent)
  │  emits via SSE:
  ▼
ToolCallStartEvent
ToolArgsDeltaEvent  } same stream as UIEvent
ToolCallResultEvent
ToolCallCancelEvent
  │
  ▼ safeParseAgentEvent (combined parser)
  │
  ▼ useAgentStream → store.send
  │
  ▼ agentReducer (one switch, ui.* + tool.* branches)
  │
AgentState {
  nodes / byKey / toasts / navigate   (existing)
  toolCalls: Map<string, ToolCall>    (new)
  toolCallsOrder: string[]            (new)
}
  │
  ▼ selector hooks
useToolCalls() : ToolCall[]
useToolCall(id) : ToolCall | undefined
  │
  ▼ headless component
<ToolCallStream render={(call) => ...} />
```

One reducer, one store, one provider. Tool events flow over the same SSE connection as UI events.

## Protocol additions (`packages/protocol/src/index.ts`)

```ts
export interface ToolCallStartEvent extends BaseEvent {
  op: "tool.start";
  id: string;       // tool call id, unique per session
  name: string;     // tool name, e.g. "search_clients"
  args?: unknown;   // optional; may stream via tool.args-delta
}

export interface ToolArgsDeltaEvent extends BaseEvent {
  op: "tool.args-delta";
  id: string;
  delta: string;    // partial JSON
}

export interface ToolCallResultEvent extends BaseEvent {
  op: "tool.result";
  id: string;
  status: "ok" | "error";
  result?: unknown;
  error?: { message: string; code?: string };
  durationMs?: number;
}

export interface ToolCallCancelEvent extends BaseEvent {
  op: "tool.cancel";
  id: string;
}

export type ToolEvent =
  | ToolCallStartEvent
  | ToolArgsDeltaEvent
  | ToolCallResultEvent
  | ToolCallCancelEvent;

export type ToolEventOp = ToolEvent["op"];

/** All wire events that flow server → client (UI patches + tool calls). */
export type AgentWireEvent = UIEvent | ToolEvent;
```

`AgentUIEvent` (the existing all-direction union) widens to `UIEvent | ToolEvent | ActionEvent`. Existing consumers of `AgentUIEvent` only narrow against `op` for UI events — back-compat preserved.

## Validate package additions (`packages/validate/src/schemas.ts`)

Four new schemas:

```ts
const toolStartSchema = baseEventSchema.extend({
  op: z.literal("tool.start"),
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  args: z.unknown().optional(),
});

const toolArgsDeltaSchema = baseEventSchema.extend({
  op: z.literal("tool.args-delta"),
  id: z.string().min(1).max(256),
  delta: z.string().max(64_000),
});

const toolResultSchema = baseEventSchema.extend({
  op: z.literal("tool.result"),
  id: z.string().min(1).max(256),
  status: z.enum(["ok", "error"]),
  result: z.unknown().optional(),
  error: z.object({
    message: z.string().min(1).max(1024),
    code: z.string().max(128).optional(),
  }).optional(),
  durationMs: z.number().nonnegative().optional(),
});

const toolCancelSchema = baseEventSchema.extend({
  op: z.literal("tool.cancel"),
  id: z.string().min(1).max(256),
});

export const toolEventSchema = z.discriminatedUnion("op", [
  toolStartSchema, toolArgsDeltaSchema, toolResultSchema, toolCancelSchema,
]);

export const agentWireEventSchema = z.discriminatedUnion("op", [
  uiAppendSchema, uiReplaceSchema, uiRemoveSchema,
  uiToastSchema, uiNavigateSchema, uiResetSchema,
  toolStartSchema, toolArgsDeltaSchema, toolResultSchema, toolCancelSchema,
]);
```

New parser exported from `packages/validate/src/index.ts`:

```ts
export function safeParseAgentEvent(raw: unknown): ParseResult<AgentWireEvent>;
```

Implementation mirrors `safeParseUIEvent` (the existing parser) but against `agentWireEventSchema`. The existing `safeParseUIEvent` stays UI-only for back-compat — third-party callers (and the validate package's own existing tests) don't break.

## React state extension (`packages/react/src/reducer.ts`)

### New types

```ts
export interface ToolCall {
  id: string;
  name: string;
  /**
   * Accumulated JSON text from `tool.args-delta` events. If `tool.start`
   * supplied initial `args`, this is `JSON.stringify(args)` to start.
   */
  argsRaw: string;
  /**
   * Best-effort parsed args. `undefined` while args are still streaming
   * and the buffer is not yet valid JSON; populated once it parses.
   */
  args: unknown | undefined;
  status: "pending" | "ok" | "error" | "cancelled";
  result?: unknown;
  error?: { message: string; code?: string };
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}
```

### `AgentState` widens

```ts
export interface AgentState {
  nodes: UINode[];
  byKey: Map<string, number>;
  toasts: Toast[];
  navigate: { href: string; replace?: boolean } | null;
  /** NEW */
  toolCalls: Map<string, ToolCall>;
  /** NEW — stable insertion order for rendering. */
  toolCallsOrder: string[];
}
```

`createInitialAgentState()` returns the two new fields with empty defaults. `ui.reset` / `__reset__` already route through `createInitialAgentState()` so they clear tool slices for free.

### `AgentAction` widens

```ts
export type AgentAction = UIEvent | ToolEvent | AgentResetAction;
```

Existing callers passing plain `UIEvent` remain type-safe (subset).

### Reducer cases

```ts
function applyToolStart(state, e: ToolCallStartEvent): AgentState {
  if (state.toolCalls.has(e.id)) return state;  // duplicate id — silent no-op
  const argsRaw = e.args !== undefined ? JSON.stringify(e.args) : "";
  const newCall: ToolCall = {
    id: e.id, name: e.name, argsRaw, args: e.args,
    status: "pending", startedAt: e.ts,
  };
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, newCall);
  return {
    ...state,
    toolCalls,
    toolCallsOrder: [...state.toolCallsOrder, e.id],
  };
}

function applyToolArgsDelta(state, e: ToolArgsDeltaEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const argsRaw = existing.argsRaw + e.delta;
  let args: unknown | undefined;
  try { args = JSON.parse(argsRaw); } catch { args = undefined; }
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, { ...existing, argsRaw, args });
  return { ...state, toolCalls };
}

function applyToolResult(state, e: ToolCallResultEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, {
    ...existing,
    status: e.status === "ok" ? "ok" : "error",
    result: e.result,
    error: e.error,
    endedAt: e.ts,
    durationMs: e.durationMs,
  });
  return { ...state, toolCalls };
}

function applyToolCancel(state, e: ToolCallCancelEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, { ...existing, status: "cancelled", endedAt: e.ts });
  return { ...state, toolCalls };
}

// Top-level switch gains four cases:
case "tool.start":       return applyToolStart(state, action);
case "tool.args-delta":  return applyToolArgsDelta(state, action);
case "tool.result":      return applyToolResult(state, action);
case "tool.cancel":      return applyToolCancel(state, action);
```

### Behavior matrix

| Event for `id` | Current status | New status | Side effect |
|---|---|---|---|
| `tool.start` | (no entry) | `pending` | append to order, populate map |
| `tool.start` | any | unchanged | silent no-op |
| `tool.args-delta` | `pending` | `pending` | append to `argsRaw`, retry `JSON.parse` |
| `tool.args-delta` | terminal | unchanged | silent no-op |
| `tool.args-delta` | (no entry) | — | silent no-op |
| `tool.result` | `pending` | `ok` or `error` | populate `result` / `error` / `endedAt` / `durationMs` |
| `tool.result` | terminal | unchanged | silent no-op |
| `tool.result` | (no entry) | — | silent no-op |
| `tool.cancel` | `pending` | `cancelled` | populate `endedAt` |
| `tool.cancel` | terminal | unchanged | silent no-op |

"Silent no-op" means the reducer returns the same state reference, the store's `send()` short-circuits the listener notification, and consumers don't re-render.

### Deviation from ticket: "log via `onInvalidEvent`"

The ticket says rejected state transitions (e.g., `tool.result` after `tool.cancel`) should "log via `onInvalidEvent`." Implementing that requires either:

1. Tool-specific knowledge in the hook (pre-validate against current state before dispatching).
2. A new "did this action apply?" signal exposed by `AgentStore`.

Both are wider blast radius than the user wants for v0.5.1. Existing reducer semantics already silently no-op invalid state transitions (e.g., `ui.replace` for an unknown key), so silent no-op for tool events is consistent. Hosts that need diagnostics can observe via `onEvent` (which still fires — the wire event WAS valid) and correlate against their own bookkeeping.

If a later ticket requires the diagnostic channel, the cleanest place to add it is on `AgentStore` (return value from `send` indicating change-or-no-change), not in the reducer or hook.

## Selectors (`packages/react/src/selectors.ts`)

```ts
export function useToolCalls(): ToolCall[] {
  return useAgentSelector(
    (s) => {
      const arr: ToolCall[] = [];
      for (const id of s.toolCallsOrder) {
        const c = s.toolCalls.get(id);
        if (c) arr.push(c);
      }
      return arr;
    },
    // Shallow array equality: same length + same references in same order.
    // Keeps consumers stable across unrelated state changes (e.g. ui.toast),
    // because state.toolCalls Map reference is preserved by spread assignment.
    (a, b) => a.length === b.length && a.every((c, i) => c === b[i]),
  );
}

export function useToolCall(id: string): ToolCall | undefined {
  return useAgentSelector((s) => s.toolCalls.get(id));
  // Default Object.is is sufficient: Map.get returns the same ToolCall
  // reference across unrelated state changes (reducer only rebuilds the
  // Map on tool events).
}
```

### Why these selectors don't add a derived array field to state

The naïve alternative — caching `toolCallsArray: ToolCall[]` on `AgentState` so the selector just reads it — would avoid the per-render array allocation. But it adds redundant state (array AND map+order), and the cost per render is small in practice (typical conversations have a handful of tool calls, not thousands). YAGNI; revisit if a profile shows hot-path allocation.

## Headless component (`packages/react/src/tool-call-stream.tsx`)

```tsx
"use client";

import { createElement, Fragment, type ReactNode } from "react";
import { useToolCalls } from "./selectors.js";
import type { ToolCall } from "./reducer.js";

export interface ToolCallStreamProps {
  /** Render each tool call in insertion order. Return JSX or null. */
  render: (call: ToolCall) => ReactNode;
}

/**
 * Headless renderer that maps `state.toolCallsOrder` through `render`. The
 * library does not impose visual styling — the pill / spinner / result UI
 * is the host's seam.
 */
export function ToolCallStream({ render }: ToolCallStreamProps) {
  const calls = useToolCalls();
  return (
    <>
      {calls.map((call) =>
        createElement(Fragment, { key: call.id }, render(call)),
      )}
    </>
  );
}
```

Per-call keyed Fragment matches the pattern from DET-135's renderer. The component has no internal state.

## `useAgentStream` change

One-line change in the SSE message handler:

```diff
- const parsed = safeParseUIEvent(raw);
+ const parsed = safeParseAgentEvent(raw);
```

Plus the import switch at the top of the file. `store.send(parsed.value)` already handles any `AgentAction`, which now includes `ToolEvent`.

## Tests

### `packages/validate/test/tool-events.test.ts` (new — 4 tests)

1. Round-trip a valid `tool.start` event with narrowing — discriminant gives `ToolCallStartEvent`.
2. Round-trip `tool.args-delta`, `tool.result`, `tool.cancel` (one test each, can be one parameterized `it.each`).
3. Reject a malformed tool event (e.g., `tool.result` missing `status`).
4. Sanity: `safeParseAgentEvent` still parses a valid `ui.append` correctly (back-compat).

### `packages/react/test/reducer-tools.test.ts` (new — 4 tests)

Imports `agentReducer`, `createInitialAgentState`. Builds events with local factory helpers.

1. **Start → args-delta → args-delta → result.** Send `tool.start("t1", "search")`, then two `args-delta` events that together form `{"q":"hi"}`, then a `tool.result("t1", "ok", { items: [] }, durationMs: 42)`. Assert final `toolCalls.get("t1")` has `status: "ok"`, `args: { q: "hi" }`, `result: { items: [] }`, `durationMs: 42`, `endedAt` set, and `argsRaw` equals the concatenated deltas.

2. **Cancel before result; late result ignored.** Send `tool.start("t2", "x")` → `tool.cancel("t2")` → `tool.result("t2", "ok")`. Assert status stays `"cancelled"` and the second-to-last state reference equals the final state reference (no-op verification).

3. **Reset clears tool calls.** Append a node, start a tool, send `{ op: "__reset__" }`. Assert `toolCalls.size === 0`, `toolCallsOrder.length === 0`, and `nodes.length === 0` (full reset).

4. **`tool.args-delta` for unknown id is a silent no-op.** Send the delta against a fresh state; assert the returned reference is identical to the input.

### `packages/react/test/tool-call-selectors.test.tsx` (new — 2 tests)

Render-counter probes wired through `<AgentStateProvider>`.

1. **`useToolCall(id)` is reference-stable across unrelated state changes.** Mount a probe for `useToolCall("t1")` and an auxiliary probe for `useAgentToasts()`. Dispatch a `tool.start("t1", "foo")` — both probes update. Dispatch a `ui.toast` — the toasts probe re-renders, the tool-call probe does NOT re-render (selector returns same `ToolCall` reference, default `Object.is` matches).

2. **`useToolCalls()` reflects insertion order.** Dispatch starts for ids `["a", "b", "c"]` in that order. Mount a probe that calls `useToolCalls()`. Assert `probe.lastValue().map(c => c.id)` equals `["a", "b", "c"]`.

### Existing tests

No changes expected to `reducer.test.ts`, `use-agent-stream.test.tsx`, `selectors.test.tsx`. The `AgentState` shape is widened but back-compat — existing assertions that only touch `nodes` / `toasts` / `navigate` continue to pass.

## File touches

| File | Action |
|---|---|
| `packages/protocol/src/index.ts` | Add 4 event interfaces + `ToolEvent` + `ToolEventOp` + `AgentWireEvent` |
| `packages/validate/src/schemas.ts` | Add 4 zod schemas + `toolEventSchema` + `agentWireEventSchema` |
| `packages/validate/src/index.ts` | Export `safeParseAgentEvent` |
| `packages/react/src/reducer.ts` | Add `ToolCall`; widen `AgentState`, `AgentAction`; 4 new reducer cases |
| `packages/react/src/selectors.ts` | Add `useToolCalls`, `useToolCall` |
| `packages/react/src/tool-call-stream.tsx` | Create — headless component |
| `packages/react/src/use-agent-stream.ts` | Switch to `safeParseAgentEvent` |
| `packages/react/src/index.ts` | New exports: `ToolCall`, `useToolCalls`, `useToolCall`, `ToolCallStream`, `ToolCallStreamProps`, plus re-exports of `ToolEvent` and the 4 event types from protocol |
| `packages/validate/test/tool-events.test.ts` | Create — 4 schema tests |
| `packages/react/test/reducer-tools.test.ts` | Create — 4 reducer tests |
| `packages/react/test/tool-call-selectors.test.tsx` | Create — 2 selector tests |
| `CHANGELOG.md` | Start v0.5.0 section above 0.4.0 |
| `README.md` | New "Tool calls" subsection under "Granular state selectors" |

## Edge cases

- **`tool.start` with the same id twice** — second start is a silent no-op (existing entry preserved). Documented; tested implicitly via behavior matrix.
- **`tool.args-delta` with malformed JSON across multiple deltas** — `args` stays `undefined`; `argsRaw` accumulates regardless. Host can show "args streaming…" by checking `args === undefined && argsRaw.length > 0`.
- **`tool.start` with both initial `args` and subsequent `tool.args-delta`** — reducer serializes initial args to `argsRaw` via `JSON.stringify`, then appends deltas. The result of `JSON.parse` on the concatenation will fail (it'll be valid JSON followed by garbage), so `args` flips to `undefined` after the first delta. This is technically a server bug if it happens, but the reducer behavior is well-defined.
- **`tool.result` with `status: "error"` and no `error` object** — allowed by schema; `error` stays undefined. Hosts handle.
- **Very large `argsRaw`** — `tool.args-delta.delta` is capped at 64KB per delta by the zod schema. No cumulative cap on `argsRaw`; if needed, that's a separate memory-bounds ticket.
- **`tool.cancel` for a non-existent id** — silent no-op. Tested.
- **Receiving `tool.*` events when no provider is mounted** — same behavior as today's UI events: `useAgentStream` keeps state in memory; selector hooks throw if used without `<AgentStateProvider>`.

## Migration

Additive everywhere. No breaking changes:

- Servers that don't emit tool events are unaffected.
- Existing `AgentState` consumers (e.g., code reading `state.nodes`) work unchanged; the two new fields are ignored.
- `safeParseUIEvent` continues to work for UI events only (back-compat); new code should use `safeParseAgentEvent`.

## Versioning

This is v0.5.0 — the first minor of the v0.5 cycle. The publish step (separate from implementation) will bump all packages to `0.5.0` and update the CHANGELOG's section header accordingly.

## Open questions

None blocking. One resolved inline:

- **Whether `useToolCalls` returns a fresh array on every call.** Yes, but with a shallow-eq selector that keeps the consumer's view stable. The alternative (caching the array on state) is rejected as premature optimization.
