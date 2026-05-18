# Tool-Call Protocol Implementation Plan (DET-139)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add typed wire events for tool calls (`tool.start` / `tool.args-delta` / `tool.result` / `tool.cancel`), extend `AgentState` with a tool-call slice, and ship selector hooks plus a headless `<ToolCallStream>` primitive.

**Architecture:** Three layers ship together. Protocol package gets 4 new event interfaces + a combined `AgentWireEvent` union. Validate package gets matching zod schemas + a `safeParseAgentEvent` parser. React package widens `AgentState` with `toolCalls: Map` + `toolCallsOrder: string[]`, adds 4 reducer cases, two selector hooks, one headless component, and swaps in the combined parser.

**Tech Stack:** TypeScript strict, zod (existing), React 19. Vitest + jsdom + @testing-library/react for tests.

**Spec:** [docs/superpowers/specs/2026-05-18-tool-call-protocol-design.md](../specs/2026-05-18-tool-call-protocol-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/protocol/src/index.ts` | Modify | Add 4 tool event interfaces, `ToolEvent` union, `ToolEventOp`, `AgentWireEvent` |
| `packages/validate/src/schemas.ts` | Modify | Add 4 zod schemas, `toolEventSchema`, `agentWireEventSchema` |
| `packages/validate/src/parse.ts` | Modify | Add `safeParseAgentEvent` |
| `packages/validate/src/index.ts` | Modify | Export `safeParseAgentEvent` |
| `packages/validate/test/tool-events.test.ts` | Create | 4 schema tests |
| `packages/react/src/reducer.ts` | Modify | Add `ToolCall`, widen `AgentState` + `AgentAction`, 4 reducer cases |
| `packages/react/test/reducer-tools.test.ts` | Create | 4 reducer tests |
| `packages/react/src/selectors.ts` | Modify | Add `useToolCalls`, `useToolCall` |
| `packages/react/src/tool-call-stream.tsx` | Create | Headless component |
| `packages/react/test/tool-call-selectors.test.tsx` | Create | 2 selector tests |
| `packages/react/src/use-agent-stream.ts` | Modify | Swap `safeParseUIEvent` → `safeParseAgentEvent` |
| `packages/react/src/index.ts` | Modify | New exports |
| `CHANGELOG.md` | Modify | Start v0.5.0 section |
| `README.md` | Modify | New "Tool calls" subsection |

---

## Conventions

- Commands run from `/Users/max/agentui`.
- Tests: `pnpm test` (one-shot — wired to `vitest run`). **Never** watch mode.
- Typecheck: `pnpm typecheck` (runs across all packages).
- After modifying `packages/protocol` or `packages/validate`, build them so downstream packages see the new types: `pnpm --filter @kibadist/agentui-protocol build && pnpm --filter @kibadist/agentui-validate build`.
- ESM `.js` relative imports throughout.

---

## Task 1: Protocol types + validate schemas + combined parser

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/validate/src/schemas.ts`
- Modify: `packages/validate/src/parse.ts`
- Modify: `packages/validate/src/index.ts`
- Create: `packages/validate/test/tool-events.test.ts`

### Step 1: Write the failing tests

Create `packages/validate/test/tool-events.test.ts` with this exact content:

```ts
import { describe, it, expect } from "vitest";
import { safeParseAgentEvent } from "../src/index.js";

describe("safeParseAgentEvent — tool events", () => {
  it("round-trips a valid tool.start event with narrowing", () => {
    const raw = {
      v: 1,
      id: "t1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.start",
      name: "search_clients",
      args: { q: "acme" },
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "tool.start") {
      expect(result.value.name).toBe("search_clients");
      expect(result.value.args).toEqual({ q: "acme" });
    }
  });

  it("round-trips a valid tool.args-delta event", () => {
    const raw = {
      v: 1,
      id: "evt-delta",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.args-delta",
      delta: '{"q":"hi"',
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "tool.args-delta") {
      expect(result.value.delta).toBe('{"q":"hi"');
    }
  });

  it("round-trips a valid tool.result event", () => {
    const raw = {
      v: 1,
      id: "evt-result",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.result",
      status: "ok",
      result: { items: [] },
      durationMs: 42,
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "tool.result") {
      expect(result.value.status).toBe("ok");
      expect(result.value.result).toEqual({ items: [] });
      expect(result.value.durationMs).toBe(42);
    }
  });

  it("round-trips a valid tool.cancel event", () => {
    const raw = {
      v: 1,
      id: "evt-cancel",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.cancel",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed tool.result (missing status)", () => {
    const raw = {
      v: 1,
      id: "evt-bad",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.result",
      // status missing
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("still parses a valid ui.append event (back-compat)", () => {
    const raw = {
      v: 1,
      id: "evt-ui",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "ui.append",
      node: { key: "a", type: "test.node", props: {} },
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "ui.append") {
      expect(result.value.node.key).toBe("a");
    }
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/validate/test/tool-events.test.ts`
Expected: failure — `safeParseAgentEvent` doesn't exist yet.

### Step 3: Add tool event interfaces to `packages/protocol/src/index.ts`

Find this line near the bottom of the file:

```ts
export type UIEvent =
  | UIAppendEvent
  | UIReplaceEvent
  | UIRemoveEvent
  | UIToastEvent
  | UINavigateEvent
  | UIResetEvent;
```

AFTER the `UIEvent` union, BEFORE the `// ─── Action Events ───` section comment, insert this block:

```ts

// ─── Tool-Call Events (server → client) ─────────────────────────────────────

export interface ToolCallStartEvent extends BaseEvent {
  op: "tool.start";
  /** Tool-call id, unique per session. */
  id: string;
  /** Tool name, e.g. "search_clients". */
  name: string;
  /** Optional initial args; may also stream via tool.args-delta. */
  args?: unknown;
}

export interface ToolArgsDeltaEvent extends BaseEvent {
  op: "tool.args-delta";
  /** Tool-call id this delta belongs to. */
  id: string;
  /** Partial JSON text to append to argsRaw. */
  delta: string;
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

/** All wire events flowing server → client (UI patches + tool calls). */
export type AgentWireEvent = UIEvent | ToolEvent;
```

### Step 4: Build the protocol package so downstream packages see the new types

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-protocol build`
Expected: build succeeds.

### Step 5: Add tool schemas to `packages/validate/src/schemas.ts`

Find this block (currently the last `uiEventSchema` discriminated union):

```ts
export const uiEventSchema = z.discriminatedUnion("op", [
  uiAppendSchema,
  uiReplaceSchema,
  uiRemoveSchema,
  uiToastSchema,
  uiNavigateSchema,
  uiResetSchema,
]);
```

AFTER it (before the `// ─── Action Events ───` section), insert this block:

```ts

// ─── Tool-Call Events ────────────────────────────────────────────────────────

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
  error: z
    .object({
      message: z.string().min(1).max(1024),
      code: z.string().max(128).optional(),
    })
    .optional(),
  durationMs: z.number().nonnegative().optional(),
});

const toolCancelSchema = baseEventSchema.extend({
  op: z.literal("tool.cancel"),
  id: z.string().min(1).max(256),
});

export const toolEventSchema = z.discriminatedUnion("op", [
  toolStartSchema,
  toolArgsDeltaSchema,
  toolResultSchema,
  toolCancelSchema,
]);

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

### Step 6: Add `safeParseAgentEvent` to `packages/validate/src/parse.ts`

Find the top imports:

```ts
import type { ZodError } from "zod";
import type { UIEvent, ActionEvent } from "@kibadist/agentui-protocol";
import { uiEventSchema, actionEventSchema } from "./schemas.js";
```

Replace with:

```ts
import type { ZodError } from "zod";
import type { UIEvent, ActionEvent, AgentWireEvent } from "@kibadist/agentui-protocol";
import { uiEventSchema, actionEventSchema, agentWireEventSchema } from "./schemas.js";
```

At the END of the file, append:

```ts

// ─── AgentWireEvent parsers (UI + Tool events combined) ─────────────────────

export function parseAgentEvent(raw: unknown): AgentWireEvent {
  return agentWireEventSchema.parse(raw) as AgentWireEvent;
}

export function safeParseAgentEvent(
  raw: unknown,
): { ok: true; value: AgentWireEvent } | { ok: false; error: ValidationError } {
  const result = agentWireEventSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data as AgentWireEvent };
  }
  return { ok: false, error: new ValidationError(result.error) };
}

export function isAgentEvent(x: unknown): x is AgentWireEvent {
  return agentWireEventSchema.safeParse(x).success;
}
```

### Step 7: Add the new exports to `packages/validate/src/index.ts`

Find the current re-export block:

```ts
export { uiNodeSchema, uiEventSchema, actionEventSchema } from "./schemas.js";
export {
  ValidationError,
  parseUIEvent,
  safeParseUIEvent,
  parseActionEvent,
  safeParseActionEvent,
  isUIEvent,
  isActionEvent,
} from "./parse.js";
```

Replace with:

```ts
export {
  uiNodeSchema,
  uiEventSchema,
  actionEventSchema,
  toolEventSchema,
  agentWireEventSchema,
} from "./schemas.js";
export {
  ValidationError,
  parseUIEvent,
  safeParseUIEvent,
  parseActionEvent,
  safeParseActionEvent,
  parseAgentEvent,
  safeParseAgentEvent,
  isUIEvent,
  isActionEvent,
  isAgentEvent,
} from "./parse.js";
```

(Keep the `describeComponents` re-export line below untouched.)

### Step 8: Build validate

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-validate build`
Expected: build succeeds.

### Step 9: Typecheck + run tests

Run: `cd /Users/max/agentui && pnpm typecheck && pnpm test packages/validate/test/tool-events.test.ts`
Expected: typecheck clean across all packages; `6 passed`.

### Step 10: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 11: Commit

```bash
cd /Users/max/agentui
git add packages/protocol/src/index.ts packages/validate/src/schemas.ts packages/validate/src/parse.ts packages/validate/src/index.ts packages/validate/test/tool-events.test.ts
git commit -m "feat(protocol,validate): add tool-call wire events + safeParseAgentEvent"
```

---

## Task 2: Reducer extension — `ToolCall` state slice + 4 reducer cases

**Files:**
- Modify: `packages/react/src/reducer.ts`
- Create: `packages/react/test/reducer-tools.test.ts`

### Step 1: Write the failing tests

Create `packages/react/test/reducer-tools.test.ts` with this exact content:

```ts
import { describe, it, expect } from "vitest";
import type {
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ToolCallResultEvent,
  ToolCallCancelEvent,
  UIAppendEvent,
} from "@kibadist/agentui-protocol";
import {
  agentReducer,
  createInitialAgentState,
  type AgentResetAction,
} from "../src/index.js";

// In the tool-event protocol, BaseEvent's `id` field IS the tool-call id —
// events for the same tool call share that id. Comment in BaseEvent says
// "unique event id (uuid)" which is true for UI events but overloaded for
// tool events (the discriminant is `op`, the correlation key is `id`).
function startEvent(id: string, name: string, args?: unknown): ToolCallStartEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "tool.start",
    name,
    args,
  };
}

function deltaEvent(id: string, delta: string): ToolArgsDeltaEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "tool.args-delta",
    delta,
  };
}

function resultEvent(
  id: string,
  status: "ok" | "error",
  result?: unknown,
  durationMs?: number,
): ToolCallResultEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:01Z",
    sessionId: "s1",
    op: "tool.result",
    status,
    result,
    durationMs,
  };
}

function cancelEvent(id: string): ToolCallCancelEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:02Z",
    sessionId: "s1",
    op: "tool.cancel",
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

describe("agentReducer — tool events", () => {
  it("start → args-delta → args-delta → result lands with parsed args", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, startEvent("t1", "search"));
    s = agentReducer(s, deltaEvent("t1", '{"q":'));
    s = agentReducer(s, deltaEvent("t1", '"hi"}'));
    s = agentReducer(s, resultEvent("t1", "ok", { items: [] }, 42));

    const tc = s.toolCalls.get("t1");
    expect(tc).toBeDefined();
    expect(tc!.status).toBe("ok");
    expect(tc!.args).toEqual({ q: "hi" });
    expect(tc!.argsRaw).toBe('{"q":"hi"}');
    expect(tc!.result).toEqual({ items: [] });
    expect(tc!.durationMs).toBe(42);
    expect(tc!.endedAt).toBe("2026-01-01T00:00:01Z");
    expect(s.toolCallsOrder).toEqual(["t1"]);
  });

  it("cancel before result; later result is silently ignored", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, startEvent("t2", "x"));
    s = agentReducer(s, cancelEvent("t2"));
    const afterCancel = s;
    s = agentReducer(s, resultEvent("t2", "ok"));

    expect(s.toolCalls.get("t2")!.status).toBe("cancelled");
    expect(s.toolCalls.get("t2")!.endedAt).toBe("2026-01-01T00:00:02Z");
    // Late result is a no-op: reducer returns the same state reference.
    expect(s).toBe(afterCancel);
  });

  it("__reset__ clears tool calls along with everything else", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, appendEvent("n1"));
    s = agentReducer(s, startEvent("t3", "x"));
    const reset: AgentResetAction = { op: "__reset__" };
    s = agentReducer(s, reset);

    expect(s.toolCalls.size).toBe(0);
    expect(s.toolCallsOrder).toEqual([]);
    expect(s.nodes).toEqual([]);
  });

  it("tool.args-delta for an unknown id is a silent no-op", () => {
    const s0 = createInitialAgentState();
    const s1 = agentReducer(s0, deltaEvent("nonexistent", "junk"));
    expect(s1).toBe(s0);
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/react/test/reducer-tools.test.ts`
Expected: failure — reducer doesn't handle tool events yet, and `createInitialAgentState` doesn't include the tool slices.

### Step 3: Replace `packages/react/src/reducer.ts` entirely

Overwrite the file with this exact content:

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

/** A transient notification queued by `ui.toast` events. */
export interface Toast {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  ts: string;
}

/** A streaming or completed tool call captured from the wire. */
export interface ToolCall {
  id: string;
  name: string;
  /**
   * Accumulated JSON text from `tool.args-delta` events. If `tool.start`
   * supplied initial `args`, this starts as `JSON.stringify(args)`.
   */
  argsRaw: string;
  /**
   * Best-effort parsed args. `undefined` while the buffered text is not
   * yet valid JSON; populated once it parses.
   */
  args: unknown | undefined;
  status: "pending" | "ok" | "error" | "cancelled";
  result?: unknown;
  error?: { message: string; code?: string };
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

/**
 * The reducer's state shape. `nodes` is the ordered list of rendered UI nodes;
 * `byKey` maps each node's key to its index for O(1) lookup; `toasts` is the
 * queue of un-dismissed notifications; `navigate` is the latest pending
 * navigation intent (or null); `toolCalls` is the streaming/completed tool
 * calls keyed by their wire id; `toolCallsOrder` is the stable insertion order.
 */
export interface AgentState {
  nodes: UINode[];
  byKey: Map<string, number>; // key → index in nodes[]
  toasts: Toast[];
  navigate: { href: string; replace?: boolean } | null;
  toolCalls: Map<string, ToolCall>;
  toolCallsOrder: string[];
}

/**
 * Create a fresh empty `AgentState`. Returns new Maps/arrays per call —
 * safe to call multiple times without aliasing.
 */
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

/**
 * @deprecated Use {@link createInitialAgentState} instead. This constant is a
 * single shared object whose `byKey` Map is reused across resets, which can
 * cause state aliasing between sessions. Kept for back-compat with v0.2.x.
 */
export const initialAgentState: AgentState = createInitialAgentState();

/**
 * Synthetic, client-only action used by `useAgentStream().reset()`.
 * Not a wire protocol event — server-driven resets use `ui.reset`.
 */
export interface AgentResetAction {
  op: "__reset__";
}

/**
 * Discriminated union over actions accepted by {@link agentReducer}: any
 * `UIEvent`, any `ToolEvent`, plus the synthetic `__reset__` action.
 */
export type AgentAction = UIEvent | ToolEvent | AgentResetAction;

function rebuildIndex(nodes: UINode[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    m.set(nodes[i].key, i);
  }
  return m;
}

function applyAppend(state: AgentState, e: UIAppendEvent): AgentState {
  const nodes = [...state.nodes];
  if (e.index !== undefined && e.index >= 0 && e.index <= nodes.length) {
    nodes.splice(e.index, 0, e.node);
  } else {
    nodes.push(e.node);
  }
  return { ...state, nodes, byKey: rebuildIndex(nodes) };
}

function applyReplace(state: AgentState, e: UIReplaceEvent): AgentState {
  const idx = state.byKey.get(e.key);
  if (idx === undefined) return state; // no-op if key not found
  const nodes = [...state.nodes];
  const existing = nodes[idx];
  nodes[idx] = {
    ...existing,
    props: e.replace ? { ...e.props } : { ...existing.props, ...e.props },
  };
  return { ...state, nodes, byKey: rebuildIndex(nodes) };
}

function applyRemove(state: AgentState, e: UIRemoveEvent): AgentState {
  const idx = state.byKey.get(e.key);
  if (idx === undefined) return state;
  const nodes = [...state.nodes];
  nodes.splice(idx, 1);
  return { ...state, nodes, byKey: rebuildIndex(nodes) };
}

/** Max number of toasts kept in state to prevent unbounded growth */
const MAX_TOASTS = 50;

function applyToast(state: AgentState, e: UIToastEvent): AgentState {
  const toast: Toast = { id: e.id, level: e.level, message: e.message, ts: e.ts };
  const toasts = [...state.toasts, toast];
  return { ...state, toasts: toasts.length > MAX_TOASTS ? toasts.slice(-MAX_TOASTS) : toasts };
}

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
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, newCall);
  return {
    ...state,
    toolCalls,
    toolCallsOrder: [...state.toolCallsOrder, e.id],
  };
}

function applyToolArgsDelta(state: AgentState, e: ToolArgsDeltaEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const argsRaw = existing.argsRaw + e.delta;
  let args: unknown | undefined;
  try {
    args = JSON.parse(argsRaw);
  } catch {
    args = undefined;
  }
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, { ...existing, argsRaw, args });
  return { ...state, toolCalls };
}

function applyToolResult(state: AgentState, e: ToolCallResultEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, {
    ...existing,
    status: e.status,
    result: e.result,
    error: e.error,
    endedAt: e.ts,
    durationMs: e.durationMs,
  });
  return { ...state, toolCalls };
}

function applyToolCancel(state: AgentState, e: ToolCallCancelEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, { ...existing, status: "cancelled", endedAt: e.ts });
  return { ...state, toolCalls };
}

/**
 * Pure reducer over `AgentState`. Returns the same state reference for
 * no-op actions (e.g., `ui.replace` for an unknown key, `tool.result` for
 * a cancelled or unknown tool call), which lets stores short-circuit
 * listener notifications.
 */
export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.op) {
    case "ui.append":
      return applyAppend(state, action);
    case "ui.replace":
      return applyReplace(state, action);
    case "ui.remove":
      return applyRemove(state, action);
    case "ui.toast":
      return applyToast(state, action);
    case "ui.navigate":
      return { ...state, navigate: { href: action.href, replace: action.replace } };
    case "ui.reset":
    case "__reset__":
      // Stance: reset is always a full clear — nodes, toasts, navigate, AND
      // tool calls. Pending navigates are stale intent ("go to /foo" issued
      // by a prior turn); after a reset we're starting over and shouldn't
      // fire them. Always return a fresh reference, even when state is
      // already empty.
      return createInitialAgentState();
    case "tool.start":
      return applyToolStart(state, action);
    case "tool.args-delta":
      return applyToolArgsDelta(state, action);
    case "tool.result":
      return applyToolResult(state, action);
    case "tool.cancel":
      return applyToolCancel(state, action);
    default:
      return state;
  }
}
```

### Step 4: Typecheck + run the new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/reducer-tools.test.ts`
Expected: typecheck clean; `4 passed`.

### Step 5: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass (existing reducer/use-agent-stream/selectors/etc. tests still green).

### Step 6: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/reducer.ts packages/react/test/reducer-tools.test.ts
git commit -m "feat(react): extend AgentState with toolCalls + reducer cases for tool events"
```

---

## Task 3: Selectors + headless component + export wiring

**Files:**
- Modify: `packages/react/src/selectors.ts`
- Create: `packages/react/src/tool-call-stream.tsx`
- Modify: `packages/react/src/index.ts`
- Create: `packages/react/test/tool-call-selectors.test.tsx`

### Step 1: Write the failing tests

Create `packages/react/test/tool-call-selectors.test.tsx` with this exact content:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type {
  ToolCallStartEvent,
  UIToastEvent,
} from "@kibadist/agentui-protocol";
import {
  AgentStateProvider,
  createAgentStore,
  ToolCallStream,
  useAgentToasts,
  useToolCall,
  useToolCalls,
} from "../src/index.js";

afterEach(cleanup);

// BaseEvent's `id` is overloaded as the tool-call id for tool events;
// events for the same call share it. See reducer-tools.test.ts comment.
function startEvent(id: string, name: string): ToolCallStartEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "tool.start",
    name,
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

describe("useToolCall / useToolCalls", () => {
  it("useToolCall(id) is reference-stable across unrelated state changes", () => {
    const store = createAgentStore();
    const toolProbe = makeProbe(() => useToolCall("t1"));
    const toastsProbe = makeProbe(useAgentToasts);

    render(
      <AgentStateProvider store={store}>
        <toolProbe.Probe />
        <toastsProbe.Probe />
      </AgentStateProvider>,
    );
    expect(toolProbe.renders()).toBe(1);
    expect(toolProbe.lastValue()).toBeUndefined();

    act(() => {
      store.send(startEvent("t1", "search"));
    });
    expect(toolProbe.renders()).toBe(2);
    expect(toolProbe.lastValue()?.name).toBe("search");

    const rendersAfterStart = toolProbe.renders();

    // Unrelated ui.toast — toasts probe re-renders, tool-call probe must NOT.
    act(() => {
      store.send(toastEvent("hi"));
    });
    expect(toastsProbe.renders()).toBeGreaterThan(1);
    expect(toolProbe.renders()).toBe(rendersAfterStart);
  });

  it("useToolCalls() reflects insertion order", () => {
    const store = createAgentStore();
    const probe = makeProbe(useToolCalls);

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.lastValue()).toEqual([]);

    act(() => {
      store.send(startEvent("a", "first"));
      store.send(startEvent("b", "second"));
      store.send(startEvent("c", "third"));
    });

    const ids = probe.lastValue()!.map((c) => c.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("ToolCallStream", () => {
  it("renders one item per tool call using the supplied render function", () => {
    const store = createAgentStore();

    const { getAllByTestId } = render(
      <AgentStateProvider store={store}>
        <ToolCallStream
          render={(call) => (
            <span data-testid={`tc-${call.id}`}>{call.name}</span>
          )}
        />
      </AgentStateProvider>,
    );
    expect(() => getAllByTestId(/^tc-/)).toThrow();

    act(() => {
      store.send(startEvent("a", "alpha"));
      store.send(startEvent("b", "beta"));
    });

    const ids = getAllByTestId(/^tc-/).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(ids).toEqual(["tc-a", "tc-b"]);
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/react/test/tool-call-selectors.test.tsx`
Expected: failure — `useToolCalls`, `useToolCall`, and `ToolCallStream` aren't exported yet.

### Step 3: Edit `packages/react/src/selectors.ts`

Find this top of the file (after the `"use client";` directive and existing imports):

```ts
"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState } from "./reducer.js";
```

Replace with:

```ts
"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "./agent-state-context.js";
import type { AgentState, ToolCall } from "./reducer.js";
```

At the END of the file (after `export const useAgentNavigate = ...`), append:

```ts

/** Subscribe to all tool calls in insertion order. Re-renders only when the tool-call slice changes. */
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
    // Keeps consumers stable when unrelated state changes (e.g. ui.toast)
    // create a new outer state object but leave the toolCalls Map intact.
    (a, b) => a.length === b.length && a.every((c, i) => c === b[i]),
  );
}

/** Subscribe to a single tool call by id. Re-renders only when that specific call's fields change. */
export function useToolCall(id: string): ToolCall | undefined {
  return useAgentSelector((s) => s.toolCalls.get(id));
}
```

### Step 4: Create `packages/react/src/tool-call-stream.tsx`

```tsx
"use client";

import { createElement, Fragment, type ReactNode } from "react";
import { useToolCalls } from "./selectors.js";
import type { ToolCall } from "./reducer.js";

/** Props for {@link ToolCallStream}. */
export interface ToolCallStreamProps {
  /** Called for each tool call in insertion order; return JSX or null. */
  render: (call: ToolCall) => ReactNode;
}

/**
 * Headless renderer that maps `state.toolCallsOrder` through `render`.
 * The library does not impose visual styling — the pill / spinner / result
 * UI is the host's seam.
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

### Step 5: Edit `packages/react/src/index.ts`

Find the existing selector export block:

```ts
export {
  useAgentSelector,
  useAgentNodes,
  useAgentToasts,
  useAgentNavigate,
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
} from "./selectors.js";
```

Find the existing reducer-type re-export:

```ts
export type { AgentState, AgentAction, AgentResetAction } from "./reducer.js";
```

Replace with:

```ts
export type { AgentState, AgentAction, AgentResetAction, ToolCall, Toast } from "./reducer.js";
```

(If `Toast` was already exported elsewhere, leave the duplicate — TypeScript merges identical re-exports. Likely it was not.)

After the existing renderer exports block (around `export { AgentRenderer } from "./renderer.js";`), add:

```ts
export { ToolCallStream } from "./tool-call-stream.js";
export type { ToolCallStreamProps } from "./tool-call-stream.js";
```

Then find the existing protocol type re-export block:

```ts
/**
 * Wire protocol event types — re-exported from `@kibadist/agentui-protocol`
 * ...
 */
export type {
  UIEvent,
  UINode,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
  UINavigateEvent,
  UIResetEvent,
} from "@kibadist/agentui-protocol";
```

Add 5 more types to that `export type { ... }` list so it becomes:

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

### Step 6: Typecheck + run the new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-react typecheck && pnpm test packages/react/test/tool-call-selectors.test.tsx`
Expected: typecheck clean; `3 passed`.

### Step 7: Run the full suite — no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 8: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/selectors.ts packages/react/src/tool-call-stream.tsx packages/react/src/index.ts packages/react/test/tool-call-selectors.test.tsx
git commit -m "feat(react): add useToolCalls + useToolCall + ToolCallStream"
```

---

## Task 4: Wire `useAgentStream` to the combined parser

**Files:**
- Modify: `packages/react/src/use-agent-stream.ts`

### Step 1: Edit `packages/react/src/use-agent-stream.ts`

Find this import line near the top:

```ts
import { safeParseUIEvent } from "@kibadist/agentui-validate";
```

Replace with:

```ts
import { safeParseAgentEvent } from "@kibadist/agentui-validate";
```

Then find this line inside the `es.onmessage` handler:

```ts
      const parsed = safeParseUIEvent(raw);
```

Replace with:

```ts
      const parsed = safeParseAgentEvent(raw);
```

These are the only two changes in this file.

Also: the `onEvent` callback type previously narrowed to `UIEvent`. With the parser switch it should accept the combined wire event. Find this line:

```ts
  /** Called for every valid UIEvent (after reducer) */
  onEvent?: (event: UIEvent) => void;
```

Replace with:

```ts
  /** Called for every valid wire event (UIEvent or ToolEvent) after the reducer applies it. */
  onEvent?: (event: import("@kibadist/agentui-protocol").AgentWireEvent) => void;
```

(Inline import to avoid widening the top-of-file imports unnecessarily.)

If the existing import line at the top of `use-agent-stream.ts` is:

```ts
import type { UIEvent } from "@kibadist/agentui-protocol";
```

Change it to:

```ts
import type { UIEvent, AgentWireEvent } from "@kibadist/agentui-protocol";
```

…and update the `onEvent` field to use the simpler `AgentWireEvent` reference:

```ts
  /** Called for every valid wire event (UIEvent or ToolEvent) after the reducer applies it. */
  onEvent?: (event: AgentWireEvent) => void;
```

(The `UIEvent` import stays — `dispatch: (event: UIEvent) => void` still uses it. Keep that exposed surface unchanged; consumers calling `dispatch` for tool events would be unusual, and widening it is a separate decision.)

### Step 2: Typecheck

Run: `cd /Users/max/agentui && pnpm typecheck`
Expected: clean across all packages.

### Step 3: Run the full suite

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass — the existing `use-agent-stream.test.tsx` still works because (a) the wire parser is a strict superset of the old one and (b) the test only sends UI events.

### Step 4: Commit

```bash
cd /Users/max/agentui
git add packages/react/src/use-agent-stream.ts
git commit -m "refactor(react): useAgentStream parses tool events via safeParseAgentEvent"
```

---

## Task 5: CHANGELOG + README

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

### Step 1: Edit `CHANGELOG.md`

Find this line near the top:

```md
## 0.4.0
```

BEFORE that line, insert a new `## 0.5.0` section. The result should be:

```md
## 0.5.0

### Added — `@kibadist/agentui-protocol`

- **Tool-call wire events.** Four new server→client events: `tool.start`, `tool.args-delta`, `tool.result`, `tool.cancel`. New types: `ToolCallStartEvent`, `ToolArgsDeltaEvent`, `ToolCallResultEvent`, `ToolCallCancelEvent`, `ToolEvent` union, `ToolEventOp`, `AgentWireEvent` (= `UIEvent | ToolEvent`).

### Added — `@kibadist/agentui-validate`

- `toolEventSchema` and `agentWireEventSchema` (combined UI + tool discriminated union).
- `safeParseAgentEvent`, `parseAgentEvent`, `isAgentEvent` — parsers for the combined wire union. `safeParseUIEvent` stays UI-only for back-compat.

### Added — `@kibadist/agentui-react`

- **Tool-call state slice on `AgentState`:** `toolCalls: Map<string, ToolCall>` and `toolCallsOrder: string[]`. Reducer handles the four new event types; `__reset__` and `ui.reset` clear them. Late `tool.result` (after `tool.cancel` or for an unknown id) is a silent no-op.
- **Selector hooks:** `useToolCalls()` and `useToolCall(id)`. Re-render only when their slice changes — `useToolCall("t1")` stays stable when a `ui.toast` arrives.
- **`<ToolCallStream render={(call) => ...} />`** — headless renderer that maps over `state.toolCallsOrder`. Host supplies the visual.
- `useAgentStream` now parses tool events via `safeParseAgentEvent`. The hook's `onEvent` callback widens to `AgentWireEvent`; existing UI-only consumers are unaffected.

### Behavior

- Servers that don't emit tool events are unaffected. `AgentState` gains two new fields with empty defaults; existing reads of `nodes`/`toasts`/`navigate` behave identically.

## 0.4.0
```

### Step 2: Edit `README.md`

Find the existing "Granular state selectors" subsection's closing line:

```md
`useAgentStream().state` keeps working — selectors are additive. The detailing-app pattern of splitting "stream-hot" and "session-stable" contexts collapses into a single `<AgentStateProvider>`.
```

After this line, BEFORE the next subsection (`### Testing helpers` from DET-137), insert a new subsection (preserve a blank line above and below):

```md

### Tool calls

Stream-LLM tool calls have a built-in state slice and a headless renderer. Wire events: `tool.start`, `tool.args-delta`, `tool.result`, `tool.cancel`.

```tsx
import {
  AgentStateProvider,
  ToolCallStream,
  useAgentStream,
  useToolCall,
} from "@kibadist/agentui-react";

function App({ url, sessionId }: { url: string; sessionId: string }) {
  const { store } = useAgentStream({ url, sessionId });
  return (
    <AgentStateProvider store={store}>
      <ToolCallStream
        render={(call) => (
          <div data-status={call.status}>
            <code>{call.name}</code>
            {call.status === "pending" && <Spinner />}
            {call.status === "ok" && <ResultPreview result={call.result} />}
            {call.status === "error" && <ErrorBadge error={call.error} />}
          </div>
        )}
      />
    </AgentStateProvider>
  );
}

// Or subscribe to one specific call:
function ToolStatusPill({ id }: { id: string }) {
  const call = useToolCall(id);
  if (!call) return null;
  return <span>{call.name} · {call.status}</span>;
}
```

`call.argsRaw` holds the accumulated JSON text from `tool.args-delta` events; `call.args` is the best-effort `JSON.parse` of that buffer (undefined while args are still streaming).
```

### Step 3: Run the full suite as a smoke check

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 4: Commit

```bash
cd /Users/max/agentui
git add CHANGELOG.md README.md
git commit -m "docs: document tool-call protocol + reducer slice + selectors (0.5.0)"
```

---

## Verification — done when

- [ ] `pnpm test` passes — adds 4 schema tests + 4 reducer tests + 3 selector/component tests = 11 new tests, total 61.
- [ ] `pnpm typecheck` clean across all packages.
- [ ] `pnpm --filter @kibadist/agentui-react build` clean.
- [ ] `git log --oneline` shows the five task commits in order.
- [ ] No version bumps in `package.json` files — release script handles the v0.5.0 bump.
- [ ] DET-139 transitioned to "Done" in Linear after the last commit lands.

## Out of scope (restated)

- Streaming tool results (`partial: true`).
- Retry / replay semantics.
- Tool-specific visual primitives (pills, spinners).
- `traceId` UX (grouping a chain of tool calls).
- `onInvalidEvent` for late-result rejections — silent reducer no-op instead (documented deviation).
