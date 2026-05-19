# Optimistic State Implementation Plan (DET-141)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 3 wire events (`optimistic.apply` / `optimistic.confirm` / `optimistic.rollback`), an `optimistic: Map<entityKey, OptimisticEntry>` slice on `AgentState`, `useOptimistic` / `useOptimisticAll` selector hooks, and widen `useAgentStream().dispatch` from `UIEvent` to `AgentWireEvent` so consumers can fire these events client-side.

**Architecture:** Same shape as the tool-call (DET-139) and reasoning (DET-140) slices, but with two differences: (1) the slice is keyed by host-defined `entityKey`, not by event id, and confirm/rollback match by `originId` instead of `entityKey` to handle the apply-A → apply-B → confirm-A race; (2) events flow in BOTH directions — server-emitted over SSE AND client-dispatched via the widened `dispatch`.

**Tech Stack:** TypeScript strict, zod, React 19, Vitest. No new runtime deps.

**Spec:** [docs/superpowers/specs/2026-05-18-optimistic-state-design.md](../specs/2026-05-18-optimistic-state-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/protocol/src/index.ts` | Modify | 3 event interfaces + `OptimisticEvent` + `OptimisticEventOp`; widen `AgentWireEvent` |
| `packages/validate/src/schemas.ts` | Modify | 3 schemas + `optimisticEventSchema`; widen `agentWireEventSchema` |
| `packages/validate/src/index.ts` | Modify | Export `optimisticEventSchema` |
| `packages/validate/test/optimistic-events.test.ts` | Create | 5 schema tests |
| `packages/react/src/reducer.ts` | Modify | `OptimisticEntry` type; widen `AgentState`; widen `AgentAction`; 3 reducer cases |
| `packages/react/test/reducer-optimistic.test.ts` | Create | 5 reducer tests |
| `packages/react/src/selectors.ts` | Modify | `useOptimistic`, `useOptimisticAll` |
| `packages/react/src/use-agent-stream.ts` | Modify | Widen `dispatch` from `UIEvent` to `AgentWireEvent` |
| `packages/react/src/index.ts` | Modify | New exports |
| `packages/react/test/optimistic-selectors.test.tsx` | Create | 3 selector tests |
| `CHANGELOG.md` | Modify | Extend existing 0.5.0 |
| `README.md` | Modify | Add "Optimistic updates" subsection |

---

## Conventions

- All commands run from `/Users/max/agentui`.
- Tests: `pnpm test` (one-shot — wired to `vitest run`). NEVER watch mode.
- Typecheck: `pnpm typecheck`.
- After modifying `packages/protocol` or `packages/validate`, build them so downstream packages see new types: `pnpm --filter @kibadist/agentui-protocol build && pnpm --filter @kibadist/agentui-validate build`.
- ESM `.js` relative imports throughout.

---

## Task 1: Protocol + validate (optimistic events)

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/validate/src/schemas.ts`
- Modify: `packages/validate/src/index.ts`
- Create: `packages/validate/test/optimistic-events.test.ts`

### Step 1: Write the failing tests

Create `packages/validate/test/optimistic-events.test.ts` with this exact content:

```ts
import { describe, it, expect } from "vitest";
import { safeParseAgentEvent } from "../src/index.js";

describe("safeParseAgentEvent — optimistic events", () => {
  it("round-trips a valid optimistic.apply with ttlMs", () => {
    const raw = {
      v: 1,
      id: "evt-apply-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.apply",
      entityKey: "quote:q-123",
      patch: { status: "confirmed" },
      originId: "origin-1",
      ttlMs: 5000,
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "optimistic.apply") {
      expect(result.value.entityKey).toBe("quote:q-123");
      expect(result.value.patch).toEqual({ status: "confirmed" });
      expect(result.value.originId).toBe("origin-1");
      expect(result.value.ttlMs).toBe(5000);
    }
  });

  it("round-trips a valid optimistic.apply without ttlMs", () => {
    const raw = {
      v: 1,
      id: "evt-apply-2",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.apply",
      entityKey: "quote:q-456",
      patch: {},
      originId: "origin-2",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "optimistic.apply") {
      expect(result.value.ttlMs).toBeUndefined();
    }
  });

  it("round-trips a valid optimistic.confirm", () => {
    const raw = {
      v: 1,
      id: "evt-confirm-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.confirm",
      originId: "origin-1",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "optimistic.confirm") {
      expect(result.value.originId).toBe("origin-1");
    }
  });

  it("round-trips a valid optimistic.rollback", () => {
    const raw = {
      v: 1,
      id: "evt-rollback-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.rollback",
      originId: "origin-1",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
  });

  it("rejects an optimistic.apply missing entityKey", () => {
    const raw = {
      v: 1,
      id: "evt-bad",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.apply",
      patch: { x: 1 },
      originId: "origin-bad",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/validate/test/optimistic-events.test.ts`
Expected: failure — optimistic ops aren't in the discriminated union yet.

### Step 3: Add optimistic interfaces to `packages/protocol/src/index.ts`

Find this block near the bottom of the file (after the reasoning events):

```ts
export type ReasoningEvent =
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent;

export type ReasoningEventOp = ReasoningEvent["op"];

/** All wire events flowing server → client (UI patches + tool calls + reasoning). */
export type AgentWireEvent = UIEvent | ToolEvent | ReasoningEvent;
```

Replace with:

```ts
export type ReasoningEvent =
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent;

export type ReasoningEventOp = ReasoningEvent["op"];

// ─── Optimistic Events (server-emittable AND client-dispatchable) ───────────

export interface OptimisticApplyEvent extends BaseEvent {
  op: "optimistic.apply";
  /** Host-defined entity identifier, e.g. "quote:q-123". */
  entityKey: string;
  /** Partial entity state to overlay. */
  patch: Record<string, unknown>;
  /** Unique id for THIS optimistic application — used by confirm/rollback. */
  originId: string;
  /** Optional TTL hint; hosts implement rollback timing themselves. */
  ttlMs?: number;
}

export interface OptimisticConfirmEvent extends BaseEvent {
  op: "optimistic.confirm";
  /** originId of the application to confirm. */
  originId: string;
}

export interface OptimisticRollbackEvent extends BaseEvent {
  op: "optimistic.rollback";
  /** originId of the application to roll back. */
  originId: string;
}

export type OptimisticEvent =
  | OptimisticApplyEvent
  | OptimisticConfirmEvent
  | OptimisticRollbackEvent;

export type OptimisticEventOp = OptimisticEvent["op"];

/** All wire events flowing server → client (UI patches + tool calls + reasoning + optimistic). */
export type AgentWireEvent = UIEvent | ToolEvent | ReasoningEvent | OptimisticEvent;
```

### Step 4: Build protocol

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-protocol build`
Expected: build succeeds.

### Step 5: Add schemas to `packages/validate/src/schemas.ts`

Find the existing `reasoningEventSchema` block (currently the last event-schema export before `agentWireEventSchema`):

```ts
export const reasoningEventSchema = z.discriminatedUnion("op", [
  reasoningStartSchema,
  reasoningDeltaSchema,
  reasoningEndSchema,
]);
```

AFTER this block, BEFORE the existing `agentWireEventSchema`, insert:

```ts

// ─── Optimistic Events ──────────────────────────────────────────────────────

const optimisticApplySchema = baseEventSchema.extend({
  op: z.literal("optimistic.apply"),
  entityKey: z.string().min(1).max(256),
  patch: z.record(z.string(), z.any()),
  originId: z.string().min(1).max(256),
  ttlMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
});

const optimisticConfirmSchema = baseEventSchema.extend({
  op: z.literal("optimistic.confirm"),
  originId: z.string().min(1).max(256),
});

const optimisticRollbackSchema = baseEventSchema.extend({
  op: z.literal("optimistic.rollback"),
  originId: z.string().min(1).max(256),
});

export const optimisticEventSchema = z.discriminatedUnion("op", [
  optimisticApplySchema,
  optimisticConfirmSchema,
  optimisticRollbackSchema,
]);
```

Then find the current `agentWireEventSchema`:

```ts
export const agentWireEventSchema = z.discriminatedUnion("op", [
  uiAppendSchema,
  uiReplaceSchema,
  uiRemoveSchema,
  uiToastSchema,
  uiNavigateSchema,
  uiResetSchema,
  toolStartSchema,
  toolArgsDeltaSchema,
  toolResultSchema,
  toolCancelSchema,
  reasoningStartSchema,
  reasoningDeltaSchema,
  reasoningEndSchema,
]);
```

Replace with (append the three optimistic schemas):

```ts
export const agentWireEventSchema = z.discriminatedUnion("op", [
  uiAppendSchema,
  uiReplaceSchema,
  uiRemoveSchema,
  uiToastSchema,
  uiNavigateSchema,
  uiResetSchema,
  toolStartSchema,
  toolArgsDeltaSchema,
  toolResultSchema,
  toolCancelSchema,
  reasoningStartSchema,
  reasoningDeltaSchema,
  reasoningEndSchema,
  optimisticApplySchema,
  optimisticConfirmSchema,
  optimisticRollbackSchema,
]);
```

### Step 6: Export `optimisticEventSchema` from `packages/validate/src/index.ts`

Find:

```ts
export {
  uiNodeSchema,
  uiEventSchema,
  actionEventSchema,
  toolEventSchema,
  reasoningEventSchema,
  agentWireEventSchema,
} from "./schemas.js";
```

Replace with:

```ts
export {
  uiNodeSchema,
  uiEventSchema,
  actionEventSchema,
  toolEventSchema,
  reasoningEventSchema,
  optimisticEventSchema,
  agentWireEventSchema,
} from "./schemas.js";
```

### Step 7: Build validate

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-validate build`
Expected: build succeeds.

### Step 8: Typecheck + run the new tests

Run: `cd /Users/max/agentui && pnpm typecheck && pnpm test packages/validate/test/optimistic-events.test.ts`
Expected: typecheck clean across all packages; `5 passed`.

If react's `AgentAction` typecheck fails because `parsed.value` (AgentWireEvent) now includes `OptimisticEvent` and the reducer's AgentAction doesn't, that's expected — Task 2 widens AgentAction. For Task 1, you may need to ALSO widen AgentAction in reducer.ts as a type-only fix (matching what happened in DET-140 Task 1). If the typecheck reports an error like "Argument of type 'AgentWireEvent' is not assignable to 'AgentAction'", then ALSO do this:

Find in `packages/react/src/reducer.ts`:

```ts
import type {
  UIEvent,
  UINode,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
  ToolEvent,
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ToolCallResultEvent,
  ToolCallCancelEvent,
  ReasoningEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
} from "@kibadist/agentui-protocol";
```

Add `OptimisticEvent` to the import. And find:

```ts
export type AgentAction = UIEvent | ToolEvent | ReasoningEvent | AgentResetAction;
```

Replace with:

```ts
export type AgentAction = UIEvent | ToolEvent | ReasoningEvent | OptimisticEvent | AgentResetAction;
```

The reducer's `default: return state` already no-ops unknown ops, so this is purely a type fix. Task 2 will add the explicit reducer cases.

### Step 9: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 10: Commit

```bash
cd /Users/max/agentui
git add packages/protocol/src/index.ts packages/validate/src/schemas.ts packages/validate/src/index.ts packages/validate/test/optimistic-events.test.ts packages/react/src/reducer.ts
git commit -m "feat(protocol,validate): add optimistic wire events"
```

(If reducer.ts wasn't modified, drop it from the `git add` line.)

---

## Task 2: Reducer — `OptimisticEntry` slice + 3 cases

**Files:**
- Modify: `packages/react/src/reducer.ts`
- Create: `packages/react/test/reducer-optimistic.test.ts`

### Step 1: Write the failing tests

Create `packages/react/test/reducer-optimistic.test.ts` with this exact content:

```ts
import { describe, it, expect } from "vitest";
import type {
  OptimisticApplyEvent,
  OptimisticConfirmEvent,
  OptimisticRollbackEvent,
} from "@kibadist/agentui-protocol";
import {
  agentReducer,
  createInitialAgentState,
  type AgentResetAction,
} from "../src/index.js";

function applyEvent(
  entityKey: string,
  patch: Record<string, unknown>,
  originId: string,
  ttlMs?: number,
): OptimisticApplyEvent {
  return {
    v: 1,
    id: `evt-apply-${originId}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "optimistic.apply",
    entityKey,
    patch,
    originId,
    ttlMs,
  };
}

function confirmEvent(originId: string): OptimisticConfirmEvent {
  return {
    v: 1,
    id: `evt-confirm-${originId}`,
    ts: "2026-01-01T00:00:01Z",
    sessionId: "s1",
    op: "optimistic.confirm",
    originId,
  };
}

function rollbackEvent(originId: string): OptimisticRollbackEvent {
  return {
    v: 1,
    id: `evt-rollback-${originId}`,
    ts: "2026-01-01T00:00:01Z",
    sessionId: "s1",
    op: "optimistic.rollback",
    originId,
  };
}

describe("agentReducer — optimistic events", () => {
  it("apply → confirm clears the entry", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q1", { status: "confirmed" }, "o1"));
    expect(s.optimistic.get("quote:q1")?.patch).toEqual({ status: "confirmed" });

    s = agentReducer(s, confirmEvent("o1"));
    expect(s.optimistic.size).toBe(0);
  });

  it("apply → rollback clears the entry", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q2", { status: "x" }, "o2"));
    s = agentReducer(s, rollbackEvent("o2"));
    expect(s.optimistic.size).toBe(0);
  });

  it("apply A → apply B (same key) → confirm A is a silent no-op", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q3", { v: 1 }, "originA"));
    s = agentReducer(s, applyEvent("quote:q3", { v: 2 }, "originB"));
    const afterB = s;

    // Confirm A's originId — A's entry was overwritten by B, so no match.
    s = agentReducer(s, confirmEvent("originA"));
    expect(s).toBe(afterB); // same state reference — no-op
    expect(s.optimistic.get("quote:q3")?.originId).toBe("originB");
    expect(s.optimistic.get("quote:q3")?.patch).toEqual({ v: 2 });
  });

  it("__reset__ clears all optimistic entries", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q4", { x: 1 }, "o4"));
    s = agentReducer(s, applyEvent("job:j1", { x: 2 }, "o5"));
    expect(s.optimistic.size).toBe(2);

    const reset: AgentResetAction = { op: "__reset__" };
    s = agentReducer(s, reset);
    expect(s.optimistic.size).toBe(0);
  });

  it("expiresAt is computed from ttlMs and applied ts", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q5", { x: 1 }, "o6", 5000));
    const entry = s.optimistic.get("quote:q5");
    expect(entry).toBeDefined();
    expect(entry!.appliedAt).toBe("2026-01-01T00:00:00Z");
    // ts + 5000ms = 2026-01-01T00:00:05.000Z
    expect(entry!.expiresAt).toBe("2026-01-01T00:00:05.000Z");
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/react/test/reducer-optimistic.test.ts`
Expected: failure — reducer doesn't handle optimistic events yet; `createInitialAgentState` doesn't include the `optimistic` field.

### Step 3: Edit `packages/react/src/reducer.ts`

**Edit A** — Verify imports include all 3 optimistic event types. Find the top imports from `@kibadist/agentui-protocol`. Ensure they include:

```ts
  OptimisticEvent,
  OptimisticApplyEvent,
  OptimisticConfirmEvent,
  OptimisticRollbackEvent,
```

If `OptimisticEvent` is already imported (from Task 1's type-fix), add the other three. Otherwise add all four.

**Edit B** — Add the `OptimisticEntry` interface. Find this comment + interface declaration:

```ts
/** A streaming or completed reasoning segment captured from the wire. */
export interface ReasoningSegment {
```

Just BEFORE that block, insert:

```ts
/** A locally-applied optimistic patch awaiting server confirmation or rollback. */
export interface OptimisticEntry {
  entityKey: string;
  patch: Record<string, unknown>;
  /** Unique id of this application (different per apply, even for same entityKey). */
  originId: string;
  appliedAt: string;
  /** Computed from `ttlMs` at apply time; host implements actual TTL via useEffect. */
  expiresAt?: string;
}

```

**Edit C** — Widen `AgentState`. Find:

```ts
export interface AgentState {
  nodes: UINode[];
  byKey: Map<string, number>; // key → index in nodes[]
  toasts: Toast[];
  navigate: { href: string; replace?: boolean } | null;
  toolCalls: Map<string, ToolCall>;
  toolCallsOrder: string[];
  reasoning: Map<string, ReasoningSegment>;
  reasoningOrder: string[];
}
```

Replace with:

```ts
export interface AgentState {
  nodes: UINode[];
  byKey: Map<string, number>; // key → index in nodes[]
  toasts: Toast[];
  navigate: { href: string; replace?: boolean } | null;
  toolCalls: Map<string, ToolCall>;
  toolCallsOrder: string[];
  reasoning: Map<string, ReasoningSegment>;
  reasoningOrder: string[];
  optimistic: Map<string, OptimisticEntry>;
}
```

**Edit D** — Update `createInitialAgentState`. Find:

```ts
export function createInitialAgentState(): AgentState {
  return {
    nodes: [],
    byKey: new Map(),
    toasts: [],
    navigate: null,
    toolCalls: new Map(),
    toolCallsOrder: [],
    reasoning: new Map(),
    reasoningOrder: [],
  };
}
```

Replace with:

```ts
export function createInitialAgentState(): AgentState {
  return {
    nodes: [],
    byKey: new Map(),
    toasts: [],
    navigate: null,
    toolCalls: new Map(),
    toolCallsOrder: [],
    reasoning: new Map(),
    reasoningOrder: [],
    optimistic: new Map(),
  };
}
```

**Edit E** — `AgentAction` is already widened (Task 1 added it as a type-fix). Verify it includes `OptimisticEvent`; if not, add it.

**Edit F** — Add the three optimistic reducer functions. Find the last existing reasoning function:

```ts
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

Just AFTER it, insert:

```ts

function applyOptimisticApply(state: AgentState, e: OptimisticApplyEvent): AgentState {
  // Last-write-wins: overwrites any prior entry for the same entityKey.
  const expiresAt =
    e.ttlMs !== undefined
      ? new Date(Date.parse(e.ts) + e.ttlMs).toISOString()
      : undefined;
  const entry: OptimisticEntry = {
    entityKey: e.entityKey,
    patch: e.patch,
    originId: e.originId,
    appliedAt: e.ts,
    expiresAt,
  };
  const optimistic = new Map(state.optimistic);
  optimistic.set(e.entityKey, entry);
  return { ...state, optimistic };
}

function applyOptimisticConfirm(state: AgentState, e: OptimisticConfirmEvent): AgentState {
  // Look up by originId — not entityKey. Iterate the Map; remove on match.
  for (const [key, entry] of state.optimistic) {
    if (entry.originId === e.originId) {
      const optimistic = new Map(state.optimistic);
      optimistic.delete(key);
      return { ...state, optimistic };
    }
  }
  return state; // no match — silent no-op (stale confirmation)
}

function applyOptimisticRollback(state: AgentState, e: OptimisticRollbackEvent): AgentState {
  // Identical reducer logic to confirm: remove by originId. The semantic
  // distinction (acknowledged vs. rejected) lives at the host layer.
  for (const [key, entry] of state.optimistic) {
    if (entry.originId === e.originId) {
      const optimistic = new Map(state.optimistic);
      optimistic.delete(key);
      return { ...state, optimistic };
    }
  }
  return state;
}
```

**Edit G** — Add three switch cases in `agentReducer`. Find the existing `reasoning.end` case:

```ts
    case "reasoning.end":
      return applyReasoningEnd(state, action);
    default:
      return state;
```

Replace with:

```ts
    case "reasoning.end":
      return applyReasoningEnd(state, action);
    case "optimistic.apply":
      return applyOptimisticApply(state, action);
    case "optimistic.confirm":
      return applyOptimisticConfirm(state, action);
    case "optimistic.rollback":
      return applyOptimisticRollback(state, action);
    default:
      return state;
```

### Step 4: Typecheck + run the new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/reducer-optimistic.test.ts`
Expected: typecheck clean; `5 passed`.

### Step 5: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 6: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/reducer.ts packages/react/test/reducer-optimistic.test.ts
git commit -m "feat(react): extend reducer with optimistic state slice"
```

---

## Task 3: Selectors + dispatch widening + selector tests

**Files:**
- Modify: `packages/react/src/selectors.ts`
- Modify: `packages/react/src/use-agent-stream.ts`
- Modify: `packages/react/src/index.ts`
- Create: `packages/react/test/optimistic-selectors.test.tsx`

### Step 1: Write the failing tests

Create `packages/react/test/optimistic-selectors.test.tsx` with this exact content:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { OptimisticApplyEvent } from "@kibadist/agentui-protocol";
import {
  AgentStateProvider,
  createAgentStore,
  useOptimistic,
  useOptimisticAll,
} from "../src/index.js";

afterEach(cleanup);

function applyEvent(
  entityKey: string,
  patch: Record<string, unknown>,
  originId: string,
): OptimisticApplyEvent {
  return {
    v: 1,
    id: `evt-apply-${originId}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "optimistic.apply",
    entityKey,
    patch,
    originId,
  };
}

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

describe("useOptimistic / useOptimisticAll", () => {
  it("useOptimistic(entityKey) returns the patch", () => {
    const store = createAgentStore();
    const probe = makeProbe(() => useOptimistic("quote:q1"));

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.lastValue()).toBeUndefined();

    act(() => {
      store.send(applyEvent("quote:q1", { status: "confirmed" }, "o1"));
    });
    expect(probe.lastValue()).toEqual({ status: "confirmed" });
  });

  it("useOptimistic(entityKey) does not re-render when an unrelated entityKey changes", () => {
    const store = createAgentStore();
    const probe = makeProbe(() => useOptimistic("quote:q1"));

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    // Initial render once.
    expect(probe.renders()).toBe(1);

    act(() => {
      store.send(applyEvent("quote:q1", { x: 1 }, "o1"));
    });
    const rendersAfterQ1 = probe.renders();

    // Apply for an unrelated key — must not re-render the q1 probe.
    act(() => {
      store.send(applyEvent("quote:q2", { y: 2 }, "o2"));
    });
    expect(probe.renders()).toBe(rendersAfterQ1);
  });

  it("useOptimisticAll() returns the Map with insertion order preserved", () => {
    const store = createAgentStore();
    const probe = makeProbe(useOptimisticAll);

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );

    act(() => {
      store.send(applyEvent("a", { a: 1 }, "oA"));
      store.send(applyEvent("b", { b: 1 }, "oB"));
      store.send(applyEvent("c", { c: 1 }, "oC"));
    });

    const keys = [...probe.lastValue()!.keys()];
    expect(keys).toEqual(["a", "b", "c"]);
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/react/test/optimistic-selectors.test.tsx`
Expected: failure — `useOptimistic` and `useOptimisticAll` aren't exported yet.

### Step 3: Edit `packages/react/src/selectors.ts`

Find the top imports:

```ts
"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState, ToolCall, ReasoningSegment } from "./reducer.js";
```

Replace with:

```ts
"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState, ToolCall, ReasoningSegment, OptimisticEntry } from "./reducer.js";
```

At the END of the file (after the existing `useLatestReasoning` export), append:

```ts

/** Subscribe to the optimistic patch for a single entity. Returns undefined when no entry. */
export function useOptimistic(entityKey: string): Record<string, unknown> | undefined {
  return useAgentSelector((s) => s.optimistic.get(entityKey)?.patch);
}

/** Subscribe to the entire optimistic Map. Re-renders on any optimistic change. */
export function useOptimisticAll(): Map<string, OptimisticEntry> {
  return useAgentSelector((s) => s.optimistic);
}
```

### Step 4: Widen `dispatch` in `packages/react/src/use-agent-stream.ts`

Find the existing dispatch field on `UseAgentStreamResult`:

```ts
  /**
   * Inject a UIEvent into the reducer without going through the wire.
   * Useful for optimistic updates, host-driven UI, and tests.
   */
  dispatch: (event: UIEvent) => void;
```

Replace with:

```ts
  /**
   * Inject a wire event into the reducer without going through SSE.
   * Useful for client-side optimistic updates, host-driven UI, and tests.
   * Accepts any AgentWireEvent (UIEvent, ToolEvent, ReasoningEvent, OptimisticEvent).
   */
  dispatch: (event: AgentWireEvent) => void;
```

Find the existing `publicDispatch` const:

```ts
  const publicDispatch = useCallback(
    (event: UIEvent) => {
      store.send(event);
    },
    [store],
  );
```

Replace with:

```ts
  const publicDispatch = useCallback(
    (event: AgentWireEvent) => {
      store.send(event);
    },
    [store],
  );
```

(The top-of-file imports should already include `AgentWireEvent` from prior DET-139/140 work. If not, add it to the `import type { ... } from "@kibadist/agentui-protocol";` block.)

### Step 5: Edit `packages/react/src/index.ts`

**Edit A** — Find the existing selector export block:

```ts
export {
  useAgentSelector,
  useAgentNodes,
  useAgentToasts,
  useAgentNavigate,
  useToolCalls,
  useToolCall,
  useReasoning,
  useLatestReasoning,
} from "./selectors.js";
```

Replace with:

```ts
export {
  useAgentSelector,
  useAgentNodes,
  useAgentToasts,
  useAgentNavigate,
  useToolCalls,
  useToolCall,
  useReasoning,
  useLatestReasoning,
  useOptimistic,
  useOptimisticAll,
} from "./selectors.js";
```

**Edit B** — Find the existing reducer-type re-export:

```ts
export type { AgentState, AgentAction, AgentResetAction, ToolCall, ReasoningSegment, Toast } from "./reducer.js";
```

Replace with:

```ts
export type { AgentState, AgentAction, AgentResetAction, ToolCall, ReasoningSegment, OptimisticEntry, Toast } from "./reducer.js";
```

**Edit C** — Find the protocol type re-export block:

```ts
export type {
  UIEvent,
  UINode,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
  UINavigateEvent,
  UIResetEvent,
  ToolEvent,
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ToolCallResultEvent,
  ToolCallCancelEvent,
  ReasoningEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
} from "@kibadist/agentui-protocol";
```

Replace with:

```ts
export type {
  UIEvent,
  UINode,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
  UINavigateEvent,
  UIResetEvent,
  ToolEvent,
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ToolCallResultEvent,
  ToolCallCancelEvent,
  ReasoningEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  OptimisticEvent,
  OptimisticApplyEvent,
  OptimisticConfirmEvent,
  OptimisticRollbackEvent,
} from "@kibadist/agentui-protocol";
```

### Step 6: Typecheck + run the new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/optimistic-selectors.test.tsx`
Expected: typecheck clean; `3 passed`.

### Step 7: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 8: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/selectors.ts packages/react/src/use-agent-stream.ts packages/react/src/index.ts packages/react/test/optimistic-selectors.test.tsx
git commit -m "feat(react): add useOptimistic + useOptimisticAll; widen dispatch to AgentWireEvent"
```

---

## Task 4: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md` (extend existing 0.5.0)
- Modify: `README.md` (new "Optimistic updates" subsection)

### Step 1: Edit `CHANGELOG.md`

Find the last bullet in `0.5.0` → `### Added — @kibadist/agentui-protocol`:

```md
- **Optional `turnId: string`** on `tool.start`, `reasoning.start`, and `ui.append` events. Hosts that ignore it see no change; per-turn grouping selectors will ship in v0.6 if there's demand.
```

After it (still in the protocol Added list, before the next `### Added` heading), insert:

```md
- **Optimistic wire events.** Three new events for optimistic UI patterns: `optimistic.apply` (entityKey + patch + originId + optional ttlMs), `optimistic.confirm` (originId), `optimistic.rollback` (originId). Server-emittable AND client-dispatchable. New types: `OptimisticApplyEvent`, `OptimisticConfirmEvent`, `OptimisticRollbackEvent`, `OptimisticEvent` union, `OptimisticEventOp`. `AgentWireEvent` widens to include them.
```

Find the last bullet in `0.5.0` → `### Added — @kibadist/agentui-validate`:

```md
- `reasoningEventSchema` is exported. `agentWireEventSchema` widens to include the three reasoning event schemas plus optional `turnId` on `tool.start` and `ui.append` schemas.
```

After it, insert:

```md
- `optimisticEventSchema` is exported. `agentWireEventSchema` widens to include the three optimistic event schemas (16 total variants now).
```

Find the last bullet in `0.5.0` → `### Added — @kibadist/agentui-react`:

```md
- **`turnId` capture:** `ReasoningSegment.turnId` is set from `reasoning.start`. `ToolCall.turnId` is set from `tool.start`. The renderer does not yet thread `turnId` from `ui.append` into `UINode.meta` — consumers needing it read via `onEvent`.
```

After it, insert these three bullets:

```md
- **Optimistic state slice on `AgentState`:** `optimistic: Map<string entityKey, OptimisticEntry>`. Reducer handles the three new event types; `__reset__` and `ui.reset` clear them. Last-write-wins on `entityKey`; confirm/rollback match by `originId` so the "apply A → apply B → confirm A" race resolves as a no-op.
- **Selector hooks:** `useOptimistic(entityKey)` returns the patch for one entity; `useOptimisticAll()` returns the full Map. The single-entity selector is reference-stable when unrelated entities change.
- **`useAgentStream().dispatch` widens to `AgentWireEvent`.** Consumers can now fire `optimistic.apply` (and any other wire event) from React code. Existing callers passing plain `UIEvent` continue to type-check unchanged. The library does NOT schedule TTL timers — hosts implement expiry via `useEffect` over `useOptimisticAll()` and dispatching `optimistic.rollback`. Documented pattern in README.
```

### Step 2: Edit `README.md`

Find the existing "Reasoning streams" subsection's closing line:

```md
For multi-segment rendering, use `useReasoning()` which returns the full ordered list. Each segment also carries an optional `turnId` (also captured on `ToolCall` from `tool.start`) — grouping selectors that join nodes/tool calls/reasoning by turn are deferred to v0.6.
```

After this line, BEFORE the next subsection or `---` separator, insert a new H3 subsection (preserve blank lines above and below):

```md

### Optimistic updates

Apply local patches before the server confirms, then drop the patch on `optimistic.confirm` or revert on `optimistic.rollback`. Events flow in both directions: the host dispatches `apply` to overlay an entity's UI, and the server emits `confirm`/`rollback` once it processes the action.

```tsx
import {
  AgentStateProvider,
  useAgentStream,
  useOptimistic,
} from "@kibadist/agentui-react";

function QuoteStatusPill({ quoteId, canonical }: { quoteId: string; canonical: { status: string } }) {
  const optimistic = useOptimistic(`quote:${quoteId}`);
  const status = (optimistic?.status as string) ?? canonical.status;
  return <span data-status={status}>{status}</span>;
}

function ConfirmButton({ quoteId, sessionId }: { quoteId: string; sessionId: string }) {
  const { dispatch } = useAgentStream({ url: "/api/agent", sessionId });
  return (
    <button
      onClick={async () => {
        const originId = crypto.randomUUID();
        dispatch({
          v: 1,
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          sessionId,
          op: "optimistic.apply",
          entityKey: `quote:${quoteId}`,
          patch: { status: "confirmed" },
          originId,
          ttlMs: 5000,
        });
        // Then fire your real action; on success the server emits
        // optimistic.confirm; on failure it emits optimistic.rollback.
      }}
    >
      Confirm
    </button>
  );
}
```

`confirm` and `rollback` both remove the entry — the semantic difference is host-side intent (telemetry, success/error animation). The library does **not** start TTL timers; if you want client-side expiry, watch `useOptimisticAll()` from a `useEffect` and dispatch `optimistic.rollback` when an entry's `expiresAt` passes.
```

### Step 3: Run the full suite as a smoke check

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 4: Commit

```bash
cd /Users/max/agentui
git add CHANGELOG.md README.md
git commit -m "docs: document optimistic state slice + selectors (0.5.0)"
```

---

## Verification — done when

- [ ] `pnpm test` passes — adds 5 schema + 5 reducer + 3 selector = 13 new tests.
- [ ] `pnpm typecheck` clean across all packages.
- [ ] `pnpm --filter @kibadist/agentui-react build` clean.
- [ ] `git log --oneline` shows the four task commits in order.
- [ ] No version bumps in `package.json` files.
- [ ] DET-141 transitioned to "Done" in Linear after the last commit lands.

## Out of scope (restated)

- Library-side TTL scheduling.
- Stacked / undo-able optimistic updates per `entityKey`.
- Auto-rendering of patches via the renderer.
- Hardening `ts` to ISO-8601 validation (would affect all events; separate ticket).
