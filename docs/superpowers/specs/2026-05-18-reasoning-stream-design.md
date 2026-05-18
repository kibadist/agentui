# Reasoning/thinking stream protocol + reducer slice (DET-140 / v0.5.2)

Linear: [DET-140 — v0.5 — Reasoning/thinking stream protocol + reducer slice](https://linear.app/detailing-app/issue/DET-140)

## Goal

Ship the protocol + state surface that consumers building on OpenAI `o1`, Anthropic extended thinking, and Gemini reasoning streams otherwise reinvent. Three wire events (`reasoning.start`, `reasoning.delta`, `reasoning.end`), one state slice (`reasoning: Map<string, ReasoningSegment>` + `reasoningOrder: string[]`), and two selector hooks (`useReasoning`, `useLatestReasoning`). Plus a cross-cutting optional `turnId: string` on `tool.start`, `reasoning.start`, and `ui.append` events for per-turn grouping (selectors deferred to v0.6).

## Non-goals (deliberate)

- A `<ReasoningStream>` headless component. Most reasoning UIs render one collapsible block driven by `useLatestReasoning()`. Multi-segment rendering can ship if demand emerges.
- Per-turn grouping selectors (`useTurns`, etc.). Wire-level `turnId` lands now; grouping selectors are v0.6.
- Reasoning cancellation (`reasoning.cancel`). Server-final by convention; reopen if needed.
- Propagating `turnId` from `ui.append` into `UINode.meta`. Wire event carries it; the renderer doesn't yet need it.

## Architecture

```
SSE wire stream
  │
  ├─ reasoning.start
  ├─ reasoning.delta  } combined with existing UI + tool events
  └─ reasoning.end
  │
  ▼ safeParseAgentEvent (already exists; widened to include 3 new schemas)
  ▼ useAgentStream → store.send
  ▼ agentReducer (one switch, ui.* + tool.* + reasoning.* branches)
  │
AgentState {
  nodes / byKey / toasts / navigate           (existing)
  toolCalls / toolCallsOrder                  (DET-139)
  reasoning: Map<string, ReasoningSegment>    (NEW)
  reasoningOrder: string[]                    (NEW)
}
  │
  ▼ selector hooks
useReasoning() : ReasoningSegment[]
useLatestReasoning() : ReasoningSegment | undefined
```

Structurally identical to DET-139. One reducer, one store, one provider.

## Protocol additions (`packages/protocol/src/index.ts`)

```ts
export interface ReasoningStartEvent extends BaseEvent {
  op: "reasoning.start";
  /** Reasoning-segment id, shared across reasoning.* events for the same segment. */
  id: string;
  /** Optional turn correlation id; see "turnId" section. */
  turnId?: string;
}

export interface ReasoningDeltaEvent extends BaseEvent {
  op: "reasoning.delta";
  /** Reasoning-segment id this delta belongs to. */
  id: string;
  /** Partial text to append to the segment. */
  delta: string;
}

export interface ReasoningEndEvent extends BaseEvent {
  op: "reasoning.end";
  /** Reasoning-segment id being finalized. */
  id: string;
  /** Optional final token count. */
  tokens?: number;
}

export type ReasoningEvent =
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent;

export type ReasoningEventOp = ReasoningEvent["op"];
```

`AgentWireEvent` widens to `UIEvent | ToolEvent | ReasoningEvent`.

## Cross-cutting `turnId` field

Three event types gain an optional `turnId?: string` (max 256 chars):

- `ToolCallStartEvent` — already shipped in DET-139; this ticket adds the field.
- `ReasoningStartEvent` — new in this ticket.
- `UIAppendEvent` — wire-level field, captured at the validation boundary but not threaded into `UINode.meta` (renderer doesn't yet have grouping concerns).

**Rationale for start-only:**
Tool calls and reasoning segments are correlated as a unit. The start event establishes the turn membership; subsequent `delta` / `result` / `end` events for the same `id` inherit that turn implicitly. Putting `turnId` on every event would be redundant and noisy on the wire.

**State capture:**
- `ToolCall.turnId?: string` — captured by `applyToolStart` (one-line addition).
- `ReasoningSegment.turnId?: string` — captured by `applyReasoningStart`.
- For `ui.append` the `turnId` lives on the validated event object only; consumers needing it for nodes read it via `onEvent`.

**Open question deferred:**
A v0.6 ticket can add `useTurns()` / `useTurn(turnId)` selectors that join nodes/tool calls/reasoning by turn. The wire format and state capture are forward-compatible.

## Validate schemas (`packages/validate/src/schemas.ts`)

```ts
const reasoningStartSchema = baseEventSchema.extend({
  op: z.literal("reasoning.start"),
  id: z.string().min(1).max(256),
  turnId: z.string().max(256).optional(),
});

const reasoningDeltaSchema = baseEventSchema.extend({
  op: z.literal("reasoning.delta"),
  id: z.string().min(1).max(256),
  delta: z.string().max(64_000),
});

const reasoningEndSchema = baseEventSchema.extend({
  op: z.literal("reasoning.end"),
  id: z.string().min(1).max(256),
  tokens: z.number().int().nonnegative().optional(),
});

export const reasoningEventSchema = z.discriminatedUnion("op", [
  reasoningStartSchema,
  reasoningDeltaSchema,
  reasoningEndSchema,
]);
```

`agentWireEventSchema` widens to include the three new schemas.

**Schema updates for `turnId` cross-cut:**

- `uiAppendSchema` gains `turnId: z.string().max(256).optional()`.
- `toolStartSchema` gains `turnId: z.string().max(256).optional()`.

(Other tool/reasoning events do NOT accept `turnId` — the start events establish the turn. The schemas reject `turnId` on `delta` / `end` / `result` / `cancel`.)

## React state extension (`packages/react/src/reducer.ts`)

### New type

```ts
export interface ReasoningSegment {
  id: string;
  /** Accumulated text from `reasoning.delta` events. */
  text: string;
  status: "streaming" | "done";
  startedAt: string;
  endedAt?: string;
  /** Optional final token count from `reasoning.end`. */
  tokens?: number;
  /** Optional turn correlation, set by `reasoning.start`. */
  turnId?: string;
}
```

### Widened types

```ts
export interface AgentState {
  // ... existing fields preserved
  reasoning: Map<string, ReasoningSegment>;
  reasoningOrder: string[];
}

export type AgentAction = UIEvent | ToolEvent | ReasoningEvent | AgentResetAction;
```

`ToolCall` gains `turnId?: string`. `applyToolStart` is updated to capture it from the event (one line).

`createInitialAgentState()` initializes the two new fields with empty defaults. `ui.reset` / `__reset__` route through `createInitialAgentState()` so they clear the reasoning slice for free.

### Reducer cases

```ts
function applyReasoningStart(state: AgentState, e: ReasoningStartEvent): AgentState {
  if (state.reasoning.has(e.id)) return state;  // duplicate — silent no-op
  const seg: ReasoningSegment = {
    id: e.id,
    text: "",
    status: "streaming",
    startedAt: e.ts,
    turnId: e.turnId,
  };
  const reasoning = new Map(state.reasoning);
  reasoning.set(e.id, seg);
  return {
    ...state,
    reasoning,
    reasoningOrder: [...state.reasoningOrder, e.id],
  };
}

function applyReasoningDelta(state: AgentState, e: ReasoningDeltaEvent): AgentState {
  const existing = state.reasoning.get(e.id);
  if (!existing || existing.status !== "streaming") return state;
  const reasoning = new Map(state.reasoning);
  reasoning.set(e.id, { ...existing, text: existing.text + e.delta });
  return { ...state, reasoning };
}

function applyReasoningEnd(state: AgentState, e: ReasoningEndEvent): AgentState {
  const existing = state.reasoning.get(e.id);
  if (!existing || existing.status !== "streaming") return state;
  const reasoning = new Map(state.reasoning);
  reasoning.set(e.id, {
    ...existing,
    status: "done",
    endedAt: e.ts,
    tokens: e.tokens,
  });
  return { ...state, reasoning };
}
```

Three new switch cases mirror the tool-call pattern. Silent no-op for invalid state transitions (duplicate start, delta/end on terminal status, missing id) — consistent with the rest of the reducer.

### Behavior matrix

| Event for `id` | Current status | New status | Side effect |
|---|---|---|---|
| `reasoning.start` | (no entry) | `streaming` | append to order, populate map |
| `reasoning.start` | any | unchanged | silent no-op |
| `reasoning.delta` | `streaming` | `streaming` | append to `text` |
| `reasoning.delta` | `done` | unchanged | silent no-op |
| `reasoning.delta` | (no entry) | — | silent no-op |
| `reasoning.end` | `streaming` | `done` | set `endedAt`, `tokens` |
| `reasoning.end` | `done` | unchanged | silent no-op |
| `reasoning.end` | (no entry) | — | silent no-op |

## Selectors (`packages/react/src/selectors.ts`)

```ts
/** Subscribe to all reasoning segments in insertion order. */
export function useReasoning(): ReasoningSegment[] {
  return useAgentSelector(
    (s) => {
      const arr: ReasoningSegment[] = [];
      for (const id of s.reasoningOrder) {
        const seg = s.reasoning.get(id);
        if (seg) arr.push(seg);
      }
      return arr;
    },
    // Same shallow-eq as useToolCalls: keeps consumer stable across unrelated
    // outer-state changes when reasoning slice is intact.
    (a, b) => a.length === b.length && a.every((s, i) => s === b[i]),
  );
}

/** Subscribe to the most recently started reasoning segment (streaming or done). */
export function useLatestReasoning(): ReasoningSegment | undefined {
  return useAgentSelector((s) => {
    const order = s.reasoningOrder;
    if (order.length === 0) return undefined;
    return s.reasoning.get(order[order.length - 1]);
  });
}
```

`useLatestReasoning` semantics: "the most recently started segment, regardless of status." During a streaming reasoning segment it returns the in-progress one; after `reasoning.end` it returns the same segment (now done). When a new `reasoning.start` arrives, the latest flips. Documented in JSDoc.

Default `Object.is` is sufficient for `useLatestReasoning` — `Map.get(latestId)` returns the same `ReasoningSegment` reference across unrelated state changes.

## Tests

### `packages/validate/test/reasoning-events.test.ts` (5 tests)

1. Round-trip `reasoning.start` with and without `turnId`.
2. Round-trip `reasoning.delta`.
3. Round-trip `reasoning.end` with and without `tokens`.
4. Reject `reasoning.delta` missing `delta` field.
5. Cross-cut sanity: `safeParseAgentEvent` parses a `tool.start` with `turnId` correctly.

### `packages/react/test/reducer-reasoning.test.ts` (4 tests)

1. **Start → delta → delta → end.** Verify final segment has accumulated text, `status: "done"`, both timestamps, `tokens` captured.
2. **`reasoning.delta` for unknown id** → silent no-op (state reference unchanged).
3. **`reasoning.end` after another `reasoning.end`** → silent no-op.
4. **`__reset__`** clears reasoning slice alongside nodes/toolCalls/toasts.

### `packages/react/test/reasoning-selectors.test.tsx` (3 tests)

1. **`useLatestReasoning()` mid-stream** returns the in-progress segment with `status: "streaming"`.
2. **`useReasoning()` insertion order** — start three segments, assert ids match order.
3. **`useLatestReasoning()` reference stability** — start a segment, dispatch `ui.toast`, assert the consumer did not re-render.

## File touches

| File | Action |
|---|---|
| `packages/protocol/src/index.ts` | Add 3 reasoning interfaces + `ReasoningEvent` + `ReasoningEventOp`; add `turnId?: string` to `ToolCallStartEvent`, `UIAppendEvent`; widen `AgentWireEvent` |
| `packages/validate/src/schemas.ts` | Add 3 reasoning schemas + `reasoningEventSchema`; add `turnId` optional to `uiAppendSchema` and `toolStartSchema`; widen `agentWireEventSchema` |
| `packages/react/src/reducer.ts` | Add `ReasoningSegment`; widen `AgentState` and `AgentAction`; 3 new reducer cases; capture `turnId` in `applyToolStart`; add `turnId` field to `ToolCall` |
| `packages/react/src/selectors.ts` | Add `useReasoning`, `useLatestReasoning` |
| `packages/react/src/index.ts` | Export `ReasoningSegment`, `useReasoning`, `useLatestReasoning`, plus protocol re-exports `ReasoningEvent`, `ReasoningStartEvent`, `ReasoningDeltaEvent`, `ReasoningEndEvent` |
| `packages/validate/test/reasoning-events.test.ts` | Create — 5 schema tests |
| `packages/react/test/reducer-reasoning.test.ts` | Create — 4 reducer tests |
| `packages/react/test/reasoning-selectors.test.tsx` | Create — 3 selector tests |
| `CHANGELOG.md` | Extend existing 0.5.0 section |
| `README.md` | Add "Reasoning streams" subsection under "Tool calls" |

## Edge cases

- **Reasoning during a tool call.** Orthogonal slices; both can be in flight simultaneously. `useReasoning()` and `useToolCalls()` don't interfere.
- **`reasoning.delta` on a `done` segment.** Silent no-op via the status guard.
- **`reasoning.end` without prior `reasoning.start`.** Silent no-op (missing entry).
- **Very long accumulated text.** No cap on `text` length in state; each `delta` is capped at 64KB. Memory-bound concerns are tracked separately by DET-150 (v0.7).
- **`turnId` provided on `tool.args-delta` / `tool.result` / `tool.cancel` / `reasoning.delta` / `reasoning.end`.** Schema rejects (not in those event types). Servers should put `turnId` only on start events.
- **Multiple concurrent reasoning streams.** Allowed. Each has a unique `id` and lives in the Map. `useLatestReasoning()` returns whichever started most recently (per `reasoningOrder`).
- **`reasoning.end` with `tokens: 0`.** Schema allows it (`nonnegative()`). State captures `tokens: 0` as a valid value distinct from `undefined`.

## Migration

Additive everywhere. Servers that don't emit reasoning events are unaffected. `AgentState` widens with two new fields with empty defaults. The cross-cutting `turnId` is optional on existing event types — wire-format backward-compatible.

Ships as part of the in-progress 0.5.0 release (same minor as DET-139's tool-call work).

## Open questions

None blocking. Two resolved inline:

- **Should `turnId` propagate from `ui.append` into `UINode.meta` so the renderer sees it?** No. Renderer doesn't have grouping concerns in v0.5.2. If consumers need per-turn rendering, they read `turnId` from `onEvent` directly. Revisit when v0.6 ships grouping selectors.
- **Should we ship `<ReasoningStream>` headless component?** No. The common UI pattern is one collapsible "show thinking" block driven by `useLatestReasoning()`. Multi-segment rendering can land if demand emerges.
