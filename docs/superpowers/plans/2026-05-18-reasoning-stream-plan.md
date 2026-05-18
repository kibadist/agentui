# Reasoning Stream Implementation Plan (DET-140)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 reasoning wire events (`reasoning.start`, `reasoning.delta`, `reasoning.end`), a `reasoning: Map<string, ReasoningSegment>` + `reasoningOrder: string[]` slice on `AgentState`, two selector hooks (`useReasoning`, `useLatestReasoning`), and an optional `turnId` field on `tool.start`, `reasoning.start`, and `ui.append` events.

**Architecture:** Structurally identical to the DET-139 tool-call work. Protocol gains 3 event interfaces + `ReasoningEvent` union, validate gains 3 schemas + widens `agentWireEventSchema`, react gains a `ReasoningSegment` type + state slice + 3 reducer cases + 2 selector hooks. `useAgentStream` already routes through `safeParseAgentEvent` (DET-139 Task 4) — no further wiring needed.

**Tech Stack:** TypeScript strict, zod, React 19, Vitest. No new deps.

**Spec:** [docs/superpowers/specs/2026-05-18-reasoning-stream-design.md](../specs/2026-05-18-reasoning-stream-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/protocol/src/index.ts` | Modify | Add 3 reasoning interfaces + `ReasoningEvent` + `ReasoningEventOp`; add `turnId?` to `ToolCallStartEvent` + `UIAppendEvent`; widen `AgentWireEvent` |
| `packages/validate/src/schemas.ts` | Modify | Add 3 reasoning schemas + `reasoningEventSchema`; add `turnId` to `uiAppendSchema` + `toolStartSchema`; widen `agentWireEventSchema` |
| `packages/validate/test/reasoning-events.test.ts` | Create | 5 schema tests |
| `packages/react/src/reducer.ts` | Modify | Add `ReasoningSegment`; widen `AgentState` + `AgentAction`; capture `turnId` in `applyToolStart`; add `turnId` field to `ToolCall`; 3 new reducer cases |
| `packages/react/test/reducer-reasoning.test.ts` | Create | 4 reducer tests |
| `packages/react/src/selectors.ts` | Modify | Add `useReasoning`, `useLatestReasoning` |
| `packages/react/src/index.ts` | Modify | New exports |
| `packages/react/test/reasoning-selectors.test.tsx` | Create | 3 selector tests |
| `CHANGELOG.md` | Modify | Extend existing 0.5.0 section |
| `README.md` | Modify | New "Reasoning streams" subsection |

---

## Conventions

- All commands run from `/Users/max/agentui`.
- Tests: `pnpm test` (one-shot — wired to `vitest run`). NEVER watch mode.
- Typecheck: `pnpm typecheck`.
- After modifying `packages/protocol` or `packages/validate`, build them: `pnpm --filter @kibadist/agentui-protocol build && pnpm --filter @kibadist/agentui-validate build`.
- ESM `.js` relative imports throughout.

---

## Task 1: Protocol + validate (reasoning events + turnId cross-cut)

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/validate/src/schemas.ts`
- Create: `packages/validate/test/reasoning-events.test.ts`

### Step 1: Write the failing tests

Create `packages/validate/test/reasoning-events.test.ts` with this exact content:

```ts
import { describe, it, expect } from "vitest";
import { safeParseAgentEvent } from "../src/index.js";

describe("safeParseAgentEvent — reasoning events", () => {
  it("round-trips a valid reasoning.start with turnId", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "reasoning.start",
      turnId: "turn-42",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "reasoning.start") {
      expect(result.value.turnId).toBe("turn-42");
    }
  });

  it("round-trips a valid reasoning.start without turnId", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "reasoning.start",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "reasoning.start") {
      expect(result.value.turnId).toBeUndefined();
    }
  });

  it("round-trips a valid reasoning.delta", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "reasoning.delta",
      delta: "Thinking about ",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "reasoning.delta") {
      expect(result.value.delta).toBe("Thinking about ");
    }
  });

  it("round-trips a valid reasoning.end with tokens", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:01Z",
      sessionId: "s1",
      op: "reasoning.end",
      tokens: 128,
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "reasoning.end") {
      expect(result.value.tokens).toBe(128);
    }
  });

  it("rejects a reasoning.delta missing delta", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "reasoning.delta",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("cross-cut: tool.start with turnId parses correctly", () => {
    const raw = {
      v: 1,
      id: "t1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.start",
      name: "search",
      turnId: "turn-7",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "tool.start") {
      expect(result.value.turnId).toBe("turn-7");
      expect(result.value.name).toBe("search");
    }
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/validate/test/reasoning-events.test.ts`
Expected: failure — reasoning ops aren't yet in the discriminated union; `turnId` isn't accepted on `tool.start`.

### Step 3: Add reasoning interfaces and turnId fields to `packages/protocol/src/index.ts`

Find this block (the tool event interfaces from DET-139):

```ts
export interface ToolCallStartEvent extends BaseEvent {
  op: "tool.start";
  /** Tool-call id, unique per session. Shared across tool.* events for the same call. */
  id: string;
  /** Tool name, e.g. "search_clients". */
  name: string;
  /** Optional initial args; may also stream via tool.args-delta. */
  args?: unknown;
}
```

Replace with (add `turnId` field):

```ts
export interface ToolCallStartEvent extends BaseEvent {
  op: "tool.start";
  /** Tool-call id, unique per session. Shared across tool.* events for the same call. */
  id: string;
  /** Tool name, e.g. "search_clients". */
  name: string;
  /** Optional initial args; may also stream via tool.args-delta. */
  args?: unknown;
  /** Optional turn correlation id (see ReasoningStartEvent for the cross-cut). */
  turnId?: string;
}
```

Find this block (the UIAppendEvent):

```ts
export interface UIAppendEvent extends BaseEvent {
  op: "ui.append";
  node: UINode;
  /** Optional insertion index (default: end) */
  index?: number;
}
```

Replace with (add `turnId` field):

```ts
export interface UIAppendEvent extends BaseEvent {
  op: "ui.append";
  node: UINode;
  /** Optional insertion index (default: end) */
  index?: number;
  /** Optional turn correlation id; consumer can read it via `onEvent`. */
  turnId?: string;
}
```

Find the existing `ToolEvent` union and the `AgentWireEvent` line. Just AFTER the line `export type AgentWireEvent = UIEvent | ToolEvent;`, insert the new reasoning interfaces and replace that AgentWireEvent line. Concretely, find:

```ts
export type ToolEvent =
  | ToolCallStartEvent
  | ToolArgsDeltaEvent
  | ToolCallResultEvent
  | ToolCallCancelEvent;

export type ToolEventOp = ToolEvent["op"];

/** All wire events flowing server → client (UI patches + tool calls). */
export type AgentWireEvent = UIEvent | ToolEvent;
```

Replace with:

```ts
export type ToolEvent =
  | ToolCallStartEvent
  | ToolArgsDeltaEvent
  | ToolCallResultEvent
  | ToolCallCancelEvent;

export type ToolEventOp = ToolEvent["op"];

// ─── Reasoning / Thinking Events (server → client) ──────────────────────────

export interface ReasoningStartEvent extends BaseEvent {
  op: "reasoning.start";
  /** Reasoning-segment id, shared across reasoning.* events for the same segment. */
  id: string;
  /** Optional turn correlation id. */
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

/** All wire events flowing server → client (UI patches + tool calls + reasoning). */
export type AgentWireEvent = UIEvent | ToolEvent | ReasoningEvent;
```

### Step 4: Build the protocol package

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-protocol build`
Expected: build succeeds.

### Step 5: Add schemas to `packages/validate/src/schemas.ts`

Find the existing `uiAppendSchema`:

```ts
const uiAppendSchema = baseEventSchema.extend({
  op: z.literal("ui.append"),
  node: uiNodeSchema,
  index: z.number().int().nonnegative().optional(),
});
```

Replace with:

```ts
const uiAppendSchema = baseEventSchema.extend({
  op: z.literal("ui.append"),
  node: uiNodeSchema,
  index: z.number().int().nonnegative().optional(),
  turnId: z.string().max(256).optional(),
});
```

Find the existing `toolStartSchema`:

```ts
const toolStartSchema = baseEventSchema.extend({
  op: z.literal("tool.start"),
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  args: z.unknown().optional(),
});
```

Replace with:

```ts
const toolStartSchema = baseEventSchema.extend({
  op: z.literal("tool.start"),
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  args: z.unknown().optional(),
  turnId: z.string().max(256).optional(),
});
```

Find the existing `toolEventSchema` block (last existing schema-related export before `agentWireEventSchema`). AFTER `toolEventSchema`, BEFORE `agentWireEventSchema`, insert the three reasoning schemas and `reasoningEventSchema`:

```ts

// ─── Reasoning / Thinking Events ────────────────────────────────────────────

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
]);
```

Replace with (append the three reasoning schemas):

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

Also export `reasoningEventSchema` from `packages/validate/src/index.ts`. Find:

```ts
export {
  uiNodeSchema,
  uiEventSchema,
  actionEventSchema,
  toolEventSchema,
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
  agentWireEventSchema,
} from "./schemas.js";
```

### Step 6: Build validate

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-validate build`
Expected: build succeeds.

### Step 7: Typecheck + run new tests

Run: `cd /Users/max/agentui && pnpm typecheck && pnpm test packages/validate/test/reasoning-events.test.ts`
Expected: typecheck clean; `6 passed`.

### Step 8: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 9: Commit

```bash
cd /Users/max/agentui
git add packages/protocol/src/index.ts packages/validate/src/schemas.ts packages/validate/src/index.ts packages/validate/test/reasoning-events.test.ts
git commit -m "feat(protocol,validate): add reasoning events + turnId cross-cut"
```

---

## Task 2: Reducer — `ReasoningSegment` slice + 3 cases + `turnId` on `ToolCall`

**Files:**
- Modify: `packages/react/src/reducer.ts`
- Create: `packages/react/test/reducer-reasoning.test.ts`

### Step 1: Write the failing tests

Create `packages/react/test/reducer-reasoning.test.ts` with this exact content:

```ts
import { describe, it, expect } from "vitest";
import type {
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  UIAppendEvent,
} from "@kibadist/agentui-protocol";
import {
  agentReducer,
  createInitialAgentState,
  type AgentResetAction,
} from "../src/index.js";

// BaseEvent `id` is overloaded as the reasoning-segment id for reasoning events;
// events for the same segment share that id value.
function startEvent(id: string, turnId?: string): ReasoningStartEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "reasoning.start",
    turnId,
  };
}

function deltaEvent(id: string, delta: string): ReasoningDeltaEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "reasoning.delta",
    delta,
  };
}

function endEvent(id: string, tokens?: number): ReasoningEndEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:01Z",
    sessionId: "s1",
    op: "reasoning.end",
    tokens,
  };
}

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

describe("agentReducer — reasoning events", () => {
  it("start → delta → delta → end produces accumulated text and done status", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, startEvent("r1", "turn-1"));
    s = agentReducer(s, deltaEvent("r1", "Thinking "));
    s = agentReducer(s, deltaEvent("r1", "about it..."));
    s = agentReducer(s, endEvent("r1", 64));

    const seg = s.reasoning.get("r1");
    expect(seg).toBeDefined();
    expect(seg!.text).toBe("Thinking about it...");
    expect(seg!.status).toBe("done");
    expect(seg!.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(seg!.endedAt).toBe("2026-01-01T00:00:01Z");
    expect(seg!.tokens).toBe(64);
    expect(seg!.turnId).toBe("turn-1");
    expect(s.reasoningOrder).toEqual(["r1"]);
  });

  it("reasoning.delta for an unknown id is a silent no-op", () => {
    const s0 = createInitialAgentState();
    const s1 = agentReducer(s0, deltaEvent("nonexistent", "junk"));
    expect(s1).toBe(s0);
  });

  it("reasoning.end after another reasoning.end is a silent no-op", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, startEvent("r2"));
    s = agentReducer(s, endEvent("r2"));
    const afterFirstEnd = s;
    s = agentReducer(s, endEvent("r2"));
    expect(s).toBe(afterFirstEnd);
    expect(s.reasoning.get("r2")!.status).toBe("done");
  });

  it("__reset__ clears reasoning slice along with everything else", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, appendEvent("n1"));
    s = agentReducer(s, startEvent("r3"));
    const reset: AgentResetAction = { op: "__reset__" };
    s = agentReducer(s, reset);

    expect(s.reasoning.size).toBe(0);
    expect(s.reasoningOrder).toEqual([]);
    expect(s.nodes).toEqual([]);
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/react/test/reducer-reasoning.test.ts`
Expected: failure — reducer doesn't handle reasoning events yet, `createInitialAgentState` doesn't include reasoning slices.

### Step 3: Edit `packages/react/src/reducer.ts`

Make several edits. The file is large, so the instructions specify precise insertion points.

**Edit A** — Update the top imports. Find:

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
} from "@kibadist/agentui-protocol";
```

Replace with:

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

**Edit B** — Add `turnId` to the `ToolCall` interface. Find:

```ts
/** A streaming or completed tool call captured from the wire. */
export interface ToolCall {
  id: string;
  name: string;
```

Replace with:

```ts
/** A streaming or completed tool call captured from the wire. */
export interface ToolCall {
  id: string;
  name: string;
  /** Optional turn correlation, captured from `tool.start`. */
  turnId?: string;
```

**Edit C** — Add the `ReasoningSegment` interface. Find this comment + interface block:

```ts
/** A streaming or completed tool call captured from the wire. */
export interface ToolCall {
```

Just BEFORE that block, insert:

```ts
/** A streaming or completed reasoning segment captured from the wire. */
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

**Edit D** — Widen `AgentState`. Find:

```ts
export interface AgentState {
  nodes: UINode[];
  byKey: Map<string, number>; // key → index in nodes[]
  toasts: Toast[];
  navigate: { href: string; replace?: boolean } | null;
  toolCalls: Map<string, ToolCall>;
  toolCallsOrder: string[];
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
}
```

**Edit E** — Update `createInitialAgentState`. Find:

```ts
export function createInitialAgentState(): AgentState {
  return {
    nodes: [],
    byKey: new Map(),
    toasts: [],
    navigate: null,
    toolCalls: new Map(),
    toolCallsOrder: [],
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
  };
}
```

**Edit F** — Widen `AgentAction`. Find:

```ts
export type AgentAction = UIEvent | ToolEvent | AgentResetAction;
```

Replace with:

```ts
export type AgentAction = UIEvent | ToolEvent | ReasoningEvent | AgentResetAction;
```

**Edit G** — Capture `turnId` in `applyToolStart`. Find:

```ts
function applyToolStart(state: AgentState, e: ToolCallStartEvent): AgentState {
  if (state.toolCalls.has(e.id)) return state; // duplicate id — silent no-op
  const argsRaw = e.args !== undefined ? JSON.stringify(e.args) : "";
  const newCall: ToolCall = {
    id: e.id,
    name: e.name,
    argsRaw,
    args: e.args,
    status: "pending",
    startedAt: e.ts,
  };
```

Replace with:

```ts
function applyToolStart(state: AgentState, e: ToolCallStartEvent): AgentState {
  if (state.toolCalls.has(e.id)) return state; // duplicate id — silent no-op
  const argsRaw = e.args !== undefined ? JSON.stringify(e.args) : "";
  const newCall: ToolCall = {
    id: e.id,
    name: e.name,
    argsRaw,
    args: e.args,
    status: "pending",
    startedAt: e.ts,
    turnId: e.turnId,
  };
```

**Edit H** — Add the three reasoning reducer functions. Find the last existing tool function `applyToolCancel`:

```ts
function applyToolCancel(state: AgentState, e: ToolCallCancelEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, { ...existing, status: "cancelled", endedAt: e.ts });
  return { ...state, toolCalls };
}
```

Just AFTER it, insert:

```ts

function applyReasoningStart(state: AgentState, e: ReasoningStartEvent): AgentState {
  if (state.reasoning.has(e.id)) return state; // duplicate id — silent no-op
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

**Edit I** — Add three switch cases in `agentReducer`. Find the existing `tool.cancel` case:

```ts
    case "tool.cancel":
      return applyToolCancel(state, action);
    default:
      return state;
```

Replace with:

```ts
    case "tool.cancel":
      return applyToolCancel(state, action);
    case "reasoning.start":
      return applyReasoningStart(state, action);
    case "reasoning.delta":
      return applyReasoningDelta(state, action);
    case "reasoning.end":
      return applyReasoningEnd(state, action);
    default:
      return state;
```

### Step 4: Typecheck + run the new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/reducer-reasoning.test.ts`
Expected: typecheck clean; `4 passed`.

### Step 5: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 6: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/reducer.ts packages/react/test/reducer-reasoning.test.ts
git commit -m "feat(react): extend reducer with reasoning slice + turnId on ToolCall"
```

---

## Task 3: Selectors + export wiring

**Files:**
- Modify: `packages/react/src/selectors.ts`
- Modify: `packages/react/src/index.ts`
- Create: `packages/react/test/reasoning-selectors.test.tsx`

### Step 1: Write the failing tests

Create `packages/react/test/reasoning-selectors.test.tsx` with this exact content:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type {
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  UIToastEvent,
} from "@kibadist/agentui-protocol";
import {
  AgentStateProvider,
  createAgentStore,
  useLatestReasoning,
  useReasoning,
} from "../src/index.js";

afterEach(cleanup);

function startEvent(id: string, turnId?: string): ReasoningStartEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "reasoning.start",
    turnId,
  };
}

function deltaEvent(id: string, delta: string): ReasoningDeltaEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "reasoning.delta",
    delta,
  };
}

function endEvent(id: string): ReasoningEndEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:01Z",
    sessionId: "s1",
    op: "reasoning.end",
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

describe("useLatestReasoning / useReasoning", () => {
  it("useLatestReasoning() returns the in-progress segment mid-stream", () => {
    const store = createAgentStore();
    const probe = makeProbe(useLatestReasoning);

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.lastValue()).toBeUndefined();

    act(() => {
      store.send(startEvent("r1"));
      store.send(deltaEvent("r1", "Hmm "));
      store.send(deltaEvent("r1", "let me think..."));
    });

    const seg = probe.lastValue();
    expect(seg).toBeDefined();
    expect(seg!.status).toBe("streaming");
    expect(seg!.text).toBe("Hmm let me think...");
  });

  it("useReasoning() reflects insertion order across multiple segments", () => {
    const store = createAgentStore();
    const probe = makeProbe(useReasoning);

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.lastValue()).toEqual([]);

    act(() => {
      store.send(startEvent("a"));
      store.send(endEvent("a"));
      store.send(startEvent("b"));
      store.send(endEvent("b"));
      store.send(startEvent("c"));
    });

    const ids = probe.lastValue()!.map((s) => s.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("useLatestReasoning() is reference-stable across unrelated state changes", () => {
    const store = createAgentStore();
    const probe = makeProbe(useLatestReasoning);

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );

    act(() => {
      store.send(startEvent("r1"));
    });
    const rendersAfterStart = probe.renders();

    // Unrelated event — must not re-render the reasoning consumer.
    act(() => {
      store.send(toastEvent("hi"));
    });
    expect(probe.renders()).toBe(rendersAfterStart);
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/react/test/reasoning-selectors.test.tsx`
Expected: failure — `useReasoning` and `useLatestReasoning` aren't exported yet.

### Step 3: Edit `packages/react/src/selectors.ts`

Find the top imports:

```ts
"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState, ToolCall } from "./reducer.js";
```

Replace with:

```ts
"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState, ToolCall, ReasoningSegment } from "./reducer.js";
```

At the END of the file (after the existing `useToolCall` export), append:

```ts

/** Subscribe to all reasoning segments in insertion order. Re-renders only when the reasoning slice changes. */
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
    (a, b) => a.length === b.length && a.every((seg, i) => seg === b[i]),
  );
}

/**
 * Subscribe to the most recently started reasoning segment (streaming or done).
 * During a streaming segment, returns the in-progress one; after `reasoning.end`
 * it still returns that segment until a new `reasoning.start` flips the latest.
 */
export function useLatestReasoning(): ReasoningSegment | undefined {
  return useAgentSelector((s) => {
    const order = s.reasoningOrder;
    if (order.length === 0) return undefined;
    return s.reasoning.get(order[order.length - 1]);
  });
}
```

### Step 4: Edit `packages/react/src/index.ts`

Find the existing selector export block:

```ts
export {
  useAgentSelector,
  useAgentNodes,
  useAgentToasts,
  useAgentNavigate,
  useToolCalls,
  useToolCall,
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
} from "./selectors.js";
```

Find the existing reducer-type re-export:

```ts
export type { AgentState, AgentAction, AgentResetAction, ToolCall, Toast } from "./reducer.js";
```

Replace with:

```ts
export type { AgentState, AgentAction, AgentResetAction, ToolCall, ReasoningSegment, Toast } from "./reducer.js";
```

Find the existing protocol type re-export block (in particular the tool event types):

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
} from "@kibadist/agentui-protocol";
```

### Step 5: Typecheck + run the new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/reasoning-selectors.test.tsx`
Expected: typecheck clean; `3 passed`.

### Step 6: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 7: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/selectors.ts packages/react/src/index.ts packages/react/test/reasoning-selectors.test.tsx
git commit -m "feat(react): add useReasoning + useLatestReasoning selectors"
```

---

## Task 4: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md` (extend existing 0.5.0)
- Modify: `README.md` (new "Reasoning streams" subsection)

### Step 1: Edit `CHANGELOG.md`

Find this line at the end of the `0.5.0` → `### Added — @kibadist/agentui-protocol` list:

```md
- **Tool-call wire events.** Four new server→client events: `tool.start`, `tool.args-delta`, `tool.result`, `tool.cancel`. New types: `ToolCallStartEvent`, `ToolArgsDeltaEvent`, `ToolCallResultEvent`, `ToolCallCancelEvent`, `ToolEvent` union, `ToolEventOp`, `AgentWireEvent` (= `UIEvent | ToolEvent`).
```

After it (still in the protocol Added list, before the next `### Added` heading), insert:

```md
- **Reasoning/thinking wire events.** Three new server→client events: `reasoning.start`, `reasoning.delta`, `reasoning.end`. New types: `ReasoningStartEvent`, `ReasoningDeltaEvent`, `ReasoningEndEvent`, `ReasoningEvent` union, `ReasoningEventOp`. `AgentWireEvent` widens to `UIEvent | ToolEvent | ReasoningEvent`.
- **Optional `turnId: string`** on `tool.start`, `reasoning.start`, and `ui.append` events. Hosts that ignore it see no change; per-turn grouping selectors will ship in v0.6 if there's demand.
```

Find this line at the end of the `0.5.0` → `### Added — @kibadist/agentui-validate` list:

```md
- `safeParseAgentEvent`, `parseAgentEvent`, `isAgentEvent` — parsers for the combined wire union. `safeParseUIEvent` stays UI-only for back-compat.
```

After it, insert:

```md
- `reasoningEventSchema` is exported. `agentWireEventSchema` widens to include the three reasoning event schemas plus optional `turnId` on `tool.start` and `ui.append` schemas.
```

Find this line at the end of the `0.5.0` → `### Added — @kibadist/agentui-react` list:

```md
- `useAgentStream` now parses tool events via `safeParseAgentEvent`. The hook's `onEvent` callback widens to `AgentWireEvent`; existing UI-only consumers are unaffected.
```

After it, insert:

```md
- **Reasoning state slice on `AgentState`:** `reasoning: Map<string, ReasoningSegment>` and `reasoningOrder: string[]`. Reducer handles the three new event types; `__reset__` and `ui.reset` clear them.
- **Selector hooks:** `useReasoning()` returns all segments in insertion order; `useLatestReasoning()` returns the most recently started segment (streaming or done).
- **`turnId` capture:** `ReasoningSegment.turnId` is set from `reasoning.start`. `ToolCall.turnId` is set from `tool.start`. The renderer does not yet thread `turnId` from `ui.append` into `UINode.meta` — consumers needing it read via `onEvent`.
```

### Step 2: Edit `README.md`

Find the existing "Tool calls" subsection's closing line:

```md
`call.argsRaw` holds the accumulated JSON text from `tool.args-delta` events; `call.args` is the best-effort `JSON.parse` of that buffer (undefined while args are still streaming).
```

After this line, BEFORE the next subsection or `---` separator, insert a new H3 subsection (preserve a blank line above and below):

```md

### Reasoning streams

Stream-LLM chain-of-thought ("reasoning" or "thinking") has its own state slice and two selector hooks. Wire events: `reasoning.start`, `reasoning.delta`, `reasoning.end`.

```tsx
import {
  AgentStateProvider,
  useAgentStream,
  useLatestReasoning,
} from "@kibadist/agentui-react";

function ThinkingPanel() {
  const seg = useLatestReasoning();
  if (!seg) return null;
  return (
    <details open={seg.status === "streaming"}>
      <summary>{seg.status === "streaming" ? "Thinking…" : "Thought"}</summary>
      <pre>{seg.text}</pre>
    </details>
  );
}

function App({ url, sessionId }: { url: string; sessionId: string }) {
  const { store } = useAgentStream({ url, sessionId });
  return (
    <AgentStateProvider store={store}>
      <ThinkingPanel />
    </AgentStateProvider>
  );
}
```

For multi-segment rendering, use `useReasoning()` which returns the full ordered list. Each segment also carries an optional `turnId` (also captured on `ToolCall` from `tool.start`) — grouping selectors that join nodes/tool calls/reasoning by turn are deferred to v0.6.
```

### Step 3: Run the full suite as a smoke check

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 4: Commit

```bash
cd /Users/max/agentui
git add CHANGELOG.md README.md
git commit -m "docs: document reasoning stream protocol + selectors (0.5.0)"
```

---

## Verification — done when

- [ ] `pnpm test` passes — adds 6 schema + 4 reducer + 3 selector = 13 new tests on top of the existing suite.
- [ ] `pnpm typecheck` clean across all packages.
- [ ] `pnpm --filter @kibadist/agentui-react build` clean.
- [ ] `git log --oneline` shows the four task commits in order.
- [ ] No version bumps in `package.json` files — release script handles versioning.
- [ ] DET-140 transitioned to "Done" in Linear after the last commit lands.

## Out of scope (restated)

- Per-turn grouping selectors (`useTurns`, `useTurn(turnId)`). v0.6.
- Headless `<ReasoningStream>` component. Hosts render `useLatestReasoning()` directly.
- Reasoning cancellation. Not in the protocol; reasoning is server-final by convention.
- Threading `turnId` from `ui.append` into `UINode.meta`. Renderer doesn't yet need it; revisit in v0.6 grouping work.
