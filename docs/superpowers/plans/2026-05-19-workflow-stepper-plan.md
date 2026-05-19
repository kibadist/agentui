# Workflow / Stepper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a workflow primitive: 4 wire events (`workflow.start`/`advance`/`complete`/`cancel`), reducer slice, `useWorkflow` hook, `<WorkflowStepper>` render-prop component.

**Architecture:** Mirrors the existing tool-call and reasoning slices. New `workflows: Map<string, Workflow>` field on `AgentState`. Reducer rules are linear & terminal (no transitions out of `completed` / `cancelled`). Renderer is render-prop only; styling is host-supplied.

**Tech Stack:** TypeScript strict, ESM-only with `.js` import extensions, Zod 3, React 18, Vitest one-shot.

---

### Task 1: Protocol types

**Files:**
- Modify: `packages/protocol/src/index.ts` — append the 4 workflow events + `WorkflowEvent` union; widen `AgentWireEvent`.

- [ ] **Step 1: Append workflow events to protocol**

In `packages/protocol/src/index.ts`, after the optimistic events section and before `// ─── Session Lifecycle Events ───`, add:

```ts
// ─── Workflow Events (server → client) ──────────────────────────────────────

export interface WorkflowStartEvent extends BaseEvent {
  op: "workflow.start";
  /** Workflow id, unique per session. Shared across workflow.* events. */
  id: string;
  /** Ordered steps. First step is the initial `current`. */
  steps: Array<{ id: string; title: string; nodeKey?: string }>;
  /** Optional turn correlation. */
  turnId?: string;
}

export interface WorkflowAdvanceEvent extends BaseEvent {
  op: "workflow.advance";
  /** Workflow id this advance applies to. */
  id: string;
  /** Step id to mark as `current`. */
  stepId: string;
}

export interface WorkflowCompleteEvent extends BaseEvent {
  op: "workflow.complete";
  /** Workflow id being completed. */
  id: string;
  /** Optional final result payload. */
  result?: unknown;
}

export interface WorkflowCancelEvent extends BaseEvent {
  op: "workflow.cancel";
  /** Workflow id being cancelled. */
  id: string;
  /** Optional cancellation reason. */
  reason?: string;
}

export type WorkflowEvent =
  | WorkflowStartEvent
  | WorkflowAdvanceEvent
  | WorkflowCompleteEvent
  | WorkflowCancelEvent;

export type WorkflowEventOp = WorkflowEvent["op"];
```

Then widen `AgentWireEvent` (search for `export type AgentWireEvent =`) to include `| WorkflowEvent`.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @kibadist/agentui-protocol typecheck && pnpm --filter @kibadist/agentui-protocol build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): add Workflow events (start/advance/complete/cancel) (DET-155)"
```

---

### Task 2: Validate schemas

**Files:**
- Modify: `packages/validate/src/schemas.ts`
- Test: `packages/validate/test/workflow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/validate/test/workflow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { safeParseUIEvent } from "../src/index.js";
import { agentWireEventSchema } from "../src/schemas.js";

const base = {
  v: 1 as const,
  id: "e1",
  ts: "2026-05-19T00:00:00.000Z",
  sessionId: "s1",
};

describe("workflow.* validation", () => {
  it("accepts a valid workflow.start", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [
        { id: "s1", title: "First" },
        { id: "s2", title: "Second", nodeKey: "node-a" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects workflow.start with empty steps", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects workflow.start with duplicate step ids", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [
        { id: "s1", title: "First" },
        { id: "s1", title: "Dup" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts workflow.advance", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.advance",
      id: "wf1",
      stepId: "s2",
    });
    expect(r.success).toBe(true);
  });

  it("rejects workflow.advance missing stepId", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.advance",
      id: "wf1",
    });
    expect(r.success).toBe(false);
  });

  it("accepts workflow.complete with arbitrary result", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.complete",
      id: "wf1",
      result: { ok: true, count: 5 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts workflow.cancel with reason", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.cancel",
      id: "wf1",
      reason: "user aborted",
    });
    expect(r.success).toBe(true);
  });

  it("rejects workflow.cancel with reason longer than 1024 chars", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.cancel",
      id: "wf1",
      reason: "x".repeat(1025),
    });
    expect(r.success).toBe(false);
  });

  it("safeParseUIEvent rejects workflow events (not UI events)", () => {
    const r = safeParseUIEvent({
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [{ id: "s1", title: "First" }],
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kibadist/agentui-validate test`
Expected: FAIL (schema not yet defined).

- [ ] **Step 3: Add schemas to `packages/validate/src/schemas.ts`**

After the optimistic-event section (just before `// ─── Session Lifecycle Events ───`), insert:

```ts
// ─── Workflow Events ────────────────────────────────────────────────────────

const workflowStepSchema = z
  .object({
    id: z.string().min(1).max(256),
    title: z.string().min(1).max(256),
    nodeKey: z.string().min(1).max(256).optional(),
  })
  .strict();

const workflowStartSchema = baseEventSchema
  .extend({
    op: z.literal("workflow.start"),
    id: z.string().min(1).max(256),
    steps: z.array(workflowStepSchema).min(1).max(64),
    turnId: z.string().max(256).optional(),
  })
  .superRefine((evt, ctx) => {
    const seen = new Set<string>();
    for (const step of evt.steps) {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate step id: ${step.id}`,
          path: ["steps"],
        });
        return;
      }
      seen.add(step.id);
    }
  });

const workflowAdvanceSchema = baseEventSchema.extend({
  op: z.literal("workflow.advance"),
  id: z.string().min(1).max(256),
  stepId: z.string().min(1).max(256),
});

const workflowCompleteSchema = baseEventSchema.extend({
  op: z.literal("workflow.complete"),
  id: z.string().min(1).max(256),
  result: z.unknown().optional(),
});

const workflowCancelSchema = baseEventSchema.extend({
  op: z.literal("workflow.cancel"),
  id: z.string().min(1).max(256),
  reason: z.string().max(1024).optional(),
});

export const workflowEventSchema = z.union([
  workflowStartSchema,
  workflowAdvanceSchema,
  workflowCompleteSchema,
  workflowCancelSchema,
]);
```

NOTE: `workflowStartSchema` is a `ZodEffects` (because of `superRefine`), so the outer `agentWireEventSchema` MUST stay `z.union` (not `z.discriminatedUnion`). Verify it is — it already became `z.union` in DET-151.

Then widen `agentWireEventSchema` (the existing `z.union([...])` block) by appending the 4 new schemas:

```ts
  // ...existing entries...
  sessionMetaSchema,
  sessionInitSchema,
  workflowStartSchema,
  workflowAdvanceSchema,
  workflowCompleteSchema,
  workflowCancelSchema,
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kibadist/agentui-validate test`
Expected: PASS (9 new tests + previous suite green).

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @kibadist/agentui-validate typecheck && pnpm --filter @kibadist/agentui-validate build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/validate/src/schemas.ts packages/validate/test/workflow.test.ts
git commit -m "feat(validate): workflow.* schemas with duplicate-step-id check (DET-155)"
```

---

### Task 3: Reducer slice

**Files:**
- Modify: `packages/react/src/reducer.ts`
- Test: `packages/react/test/reducer-workflow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/react/test/reducer-workflow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { agentReducer, createInitialAgentState } from "../src/reducer.js";
import type {
  WorkflowStartEvent,
  WorkflowAdvanceEvent,
  WorkflowCompleteEvent,
  WorkflowCancelEvent,
} from "@kibadist/agentui-protocol";

const base = (id: string, ts = "2026-05-19T00:00:00.000Z") => ({
  v: 1 as const,
  id,
  ts,
  sessionId: "s1",
});

function start(): WorkflowStartEvent {
  return {
    ...base("e1"),
    op: "workflow.start",
    id: "wf1",
    steps: [
      { id: "a", title: "First" },
      { id: "b", title: "Second" },
      { id: "c", title: "Third" },
    ],
  };
}

function advance(stepId: string, eid = "e2"): WorkflowAdvanceEvent {
  return { ...base(eid), op: "workflow.advance", id: "wf1", stepId };
}

function complete(eid = "e3", result?: unknown): WorkflowCompleteEvent {
  return { ...base(eid), op: "workflow.complete", id: "wf1", result };
}

function cancel(eid = "e4", reason?: string): WorkflowCancelEvent {
  return { ...base(eid), op: "workflow.cancel", id: "wf1", reason };
}

describe("workflow reducer", () => {
  it("workflow.start initializes with first step current, rest pending", () => {
    const s = agentReducer(createInitialAgentState(), start());
    const wf = s.workflows.get("wf1")!;
    expect(wf.status).toBe("active");
    expect(wf.currentStepId).toBe("a");
    expect(wf.steps.map((x) => x.status)).toEqual(["current", "pending", "pending"]);
    expect(wf.startedAt).toBe("2026-05-19T00:00:00.000Z");
  });

  it("workflow.advance updates step statuses (earlier=completed, target=current, later=pending)", () => {
    let s = agentReducer(createInitialAgentState(), start());
    s = agentReducer(s, advance("b"));
    const wf = s.workflows.get("wf1")!;
    expect(wf.currentStepId).toBe("b");
    expect(wf.steps.map((x) => x.status)).toEqual(["completed", "current", "pending"]);
  });

  it("workflow.advance backwards rewinds later steps to pending", () => {
    let s = agentReducer(createInitialAgentState(), start());
    s = agentReducer(s, advance("c"));
    s = agentReducer(s, advance("a", "e3"));
    const wf = s.workflows.get("wf1")!;
    expect(wf.currentStepId).toBe("a");
    expect(wf.steps.map((x) => x.status)).toEqual(["current", "pending", "pending"]);
  });

  it("workflow.complete sets status and result; step statuses unchanged", () => {
    let s = agentReducer(createInitialAgentState(), start());
    s = agentReducer(s, advance("b"));
    s = agentReducer(s, complete("e3", { ok: true }));
    const wf = s.workflows.get("wf1")!;
    expect(wf.status).toBe("completed");
    expect(wf.result).toEqual({ ok: true });
    expect(wf.endedAt).toBeDefined();
    expect(wf.steps.map((x) => x.status)).toEqual(["completed", "current", "pending"]);
  });

  it("workflow.cancel sets status and reason", () => {
    let s = agentReducer(createInitialAgentState(), start());
    s = agentReducer(s, cancel("e2", "user aborted"));
    const wf = s.workflows.get("wf1")!;
    expect(wf.status).toBe("cancelled");
    expect(wf.reason).toBe("user aborted");
    expect(wf.endedAt).toBeDefined();
  });

  it("advance after complete is a no-op (same reference)", () => {
    let s = agentReducer(createInitialAgentState(), start());
    s = agentReducer(s, complete());
    const before = s.workflows;
    const after = agentReducer(s, advance("b")).workflows;
    expect(after).toBe(before);
  });

  it("advance after cancel is a no-op", () => {
    let s = agentReducer(createInitialAgentState(), start());
    s = agentReducer(s, cancel());
    const before = s.workflows;
    const after = agentReducer(s, advance("b")).workflows;
    expect(after).toBe(before);
  });

  it("complete after cancel is a no-op", () => {
    let s = agentReducer(createInitialAgentState(), start());
    s = agentReducer(s, cancel());
    const before = s.workflows;
    const after = agentReducer(s, complete()).workflows;
    expect(after).toBe(before);
  });

  it("advance on unknown workflow id is a no-op", () => {
    const s0 = createInitialAgentState();
    const s = agentReducer(s0, advance("a"));
    expect(s.workflows).toBe(s0.workflows);
  });

  it("advance with unknown stepId is a no-op", () => {
    const s0 = agentReducer(createInitialAgentState(), start());
    const s = agentReducer(s0, advance("zzz"));
    expect(s.workflows).toBe(s0.workflows);
  });

  it("duplicate workflow.start is a no-op (first wins)", () => {
    const s0 = agentReducer(createInitialAgentState(), start());
    const second = {
      ...start(),
      id: "e2",
      steps: [{ id: "x", title: "Different" }],
    } as WorkflowStartEvent;
    const s = agentReducer(s0, second);
    expect(s.workflows).toBe(s0.workflows);
    expect(s.workflows.get("wf1")!.steps[0].id).toBe("a");
  });

  it("ui.reset clears workflows", () => {
    let s = agentReducer(createInitialAgentState(), start());
    expect(s.workflows.size).toBe(1);
    s = agentReducer(s, {
      ...base("e2"),
      op: "ui.reset",
    });
    expect(s.workflows.size).toBe(0);
  });

  it("non-workflow action returns the same workflows reference", () => {
    const s0 = agentReducer(createInitialAgentState(), start());
    const s = agentReducer(s0, {
      ...base("e2"),
      op: "ui.toast",
      level: "info",
      message: "x",
    });
    expect(s.workflows).toBe(s0.workflows);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kibadist/agentui-react test -- reducer-workflow`
Expected: FAIL — types not in `AgentAction`, no apply functions yet.

- [ ] **Step 3: Update reducer.ts**

In `packages/react/src/reducer.ts`:

a. Add `WorkflowEvent` and its subtypes to the import block from `@kibadist/agentui-protocol`:

```ts
import type {
  // ...existing imports...
  WorkflowEvent,
  WorkflowStartEvent,
  WorkflowAdvanceEvent,
  WorkflowCompleteEvent,
  WorkflowCancelEvent,
} from "@kibadist/agentui-protocol";
```

b. Add Workflow types (place after the existing slice types like `OptimisticEntry`, before `AgentState`):

```ts
export type WorkflowStatus = "active" | "completed" | "cancelled";
export type WorkflowStepStatus = "pending" | "current" | "completed" | "skipped";

export interface WorkflowStep {
  id: string;
  title: string;
  nodeKey?: string;
  status: WorkflowStepStatus;
}

export interface Workflow {
  id: string;
  steps: WorkflowStep[];
  currentStepId: string;
  status: WorkflowStatus;
  result?: unknown;
  reason?: string;
  startedAt: string;
  endedAt?: string;
}
```

c. Add `workflows: Map<string, Workflow>` to the `AgentState` interface (after `capabilities`):

```ts
export interface AgentState {
  // ...existing fields
  capabilities: Capabilities;
  workflows: Map<string, Workflow>;
}
```

d. Update `createInitialAgentState()` to include `workflows: new Map()`.

e. Widen `AgentAction`:

```ts
export type AgentAction =
  | UIEvent
  | ToolEvent
  | ReasoningEvent
  | OptimisticEvent
  | SessionMetaEvent
  | SessionInitEvent
  | WorkflowEvent
  | AgentResetAction;
```

f. Add the four apply functions (after the optimistic ones, before `applySessionInit`):

```ts
function applyWorkflowStart(state: AgentState, e: WorkflowStartEvent): AgentState {
  if (state.workflows.has(e.id)) return state;
  const steps: WorkflowStep[] = e.steps.map((s, i) => ({
    id: s.id,
    title: s.title,
    nodeKey: s.nodeKey,
    status: i === 0 ? "current" : "pending",
  }));
  const wf: Workflow = {
    id: e.id,
    steps,
    currentStepId: e.steps[0].id,
    status: "active",
    startedAt: e.ts,
  };
  const workflows = new Map(state.workflows);
  workflows.set(e.id, wf);
  return { ...state, workflows };
}

function applyWorkflowAdvance(state: AgentState, e: WorkflowAdvanceEvent): AgentState {
  const existing = state.workflows.get(e.id);
  if (!existing || existing.status !== "active") return state;
  const pos = existing.steps.findIndex((s) => s.id === e.stepId);
  if (pos < 0) return state;
  const steps: WorkflowStep[] = existing.steps.map((s, i) => ({
    ...s,
    status: i < pos ? "completed" : i === pos ? "current" : "pending",
  }));
  const workflows = new Map(state.workflows);
  workflows.set(e.id, { ...existing, steps, currentStepId: e.stepId });
  return { ...state, workflows };
}

function applyWorkflowComplete(state: AgentState, e: WorkflowCompleteEvent): AgentState {
  const existing = state.workflows.get(e.id);
  if (!existing || existing.status !== "active") return state;
  const workflows = new Map(state.workflows);
  workflows.set(e.id, {
    ...existing,
    status: "completed",
    result: e.result,
    endedAt: e.ts,
  });
  return { ...state, workflows };
}

function applyWorkflowCancel(state: AgentState, e: WorkflowCancelEvent): AgentState {
  const existing = state.workflows.get(e.id);
  if (!existing || existing.status !== "active") return state;
  const workflows = new Map(state.workflows);
  workflows.set(e.id, {
    ...existing,
    status: "cancelled",
    reason: e.reason,
    endedAt: e.ts,
  });
  return { ...state, workflows };
}
```

g. Wire the cases into `agentReducer`:

```ts
    case "workflow.start":
      return applyWorkflowStart(state, action);
    case "workflow.advance":
      return applyWorkflowAdvance(state, action);
    case "workflow.complete":
      return applyWorkflowComplete(state, action);
    case "workflow.cancel":
      return applyWorkflowCancel(state, action);
```

h. The `ui.reset` / `__reset__` branch already calls `createInitialAgentState()` and spreads — `workflows: new Map()` from the initial state will replace existing workflows automatically. No change needed (but verify the spread keeps `capabilities`).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @kibadist/agentui-react test -- reducer-workflow`
Expected: PASS (13 tests).

- [ ] **Step 5: Typecheck + full package test**

Run: `pnpm --filter @kibadist/agentui-react typecheck && pnpm --filter @kibadist/agentui-react test`
Expected: clean across whole react test suite (no regressions).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/reducer.ts packages/react/test/reducer-workflow.test.ts
git commit -m "feat(react): workflow slice in reducer (start/advance/complete/cancel) (DET-155)"
```

---

### Task 4: `useWorkflow` hook

**Files:**
- Create: `packages/react/src/use-workflow.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/test/use-workflow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/test/use-workflow.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { createAgentStore } from "../src/store.js";
import { AgentStateProvider } from "../src/agent-state-context.js";
import { useWorkflow } from "../src/use-workflow.js";
import type { WorkflowStartEvent, WorkflowAdvanceEvent } from "@kibadist/agentui-protocol";
import type { ReactNode } from "react";

afterEach(cleanup);

const base = (id: string) => ({
  v: 1 as const,
  id,
  ts: "2026-05-19T00:00:00.000Z",
  sessionId: "s1",
});

function start(): WorkflowStartEvent {
  return {
    ...base("e1"),
    op: "workflow.start",
    id: "wf1",
    steps: [
      { id: "a", title: "First" },
      { id: "b", title: "Second" },
    ],
  };
}

function advance(stepId: string): WorkflowAdvanceEvent {
  return { ...base("e2"), op: "workflow.advance", id: "wf1", stepId };
}

function setup() {
  const store = createAgentStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AgentStateProvider store={store}>{children}</AgentStateProvider>
  );
  return { store, wrapper };
}

describe("useWorkflow", () => {
  it("returns undefined for unknown id", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useWorkflow("nope"), { wrapper });
    expect(result.current.workflow).toBeUndefined();
    expect(result.current.currentStep).toBeUndefined();
    expect(result.current.isActive).toBe(false);
    expect(result.current.isDone).toBe(false);
  });

  it("returns the workflow + currentStep after workflow.start", () => {
    const { store, wrapper } = setup();
    act(() => {
      store.dispatch(start());
    });
    const { result } = renderHook(() => useWorkflow("wf1"), { wrapper });
    expect(result.current.workflow?.id).toBe("wf1");
    expect(result.current.currentStep?.id).toBe("a");
    expect(result.current.isActive).toBe(true);
    expect(result.current.isDone).toBe(false);
  });

  it("reflects advance and complete", () => {
    const { store, wrapper } = setup();
    act(() => {
      store.dispatch(start());
    });
    const { result } = renderHook(() => useWorkflow("wf1"), { wrapper });
    act(() => {
      store.dispatch(advance("b"));
    });
    expect(result.current.currentStep?.id).toBe("b");
    act(() => {
      store.dispatch({
        ...base("e3"),
        op: "workflow.complete",
        id: "wf1",
        result: { ok: true },
      });
    });
    expect(result.current.isActive).toBe(false);
    expect(result.current.isDone).toBe(true);
  });

  it("returned object is stable across unrelated dispatches", () => {
    const { store, wrapper } = setup();
    act(() => {
      store.dispatch(start());
    });
    const { result } = renderHook(() => useWorkflow("wf1"), { wrapper });
    const first = result.current;
    act(() => {
      store.dispatch({
        ...base("e2"),
        op: "ui.toast",
        level: "info",
        message: "x",
      });
    });
    expect(result.current).toBe(first);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kibadist/agentui-react test -- use-workflow`
Expected: FAIL — `useWorkflow` not exported.

- [ ] **Step 3: Implement the hook**

Create `packages/react/src/use-workflow.ts`:

```ts
import { useMemo } from "react";
import { useAgentSelector } from "./selectors.js";
import type { Workflow, WorkflowStep } from "./reducer.js";

export interface UseWorkflowResult {
  workflow: Workflow | undefined;
  /** Convenience: the current step. */
  currentStep: WorkflowStep | undefined;
  /** Convenience: true when status === "active". */
  isActive: boolean;
  /** Convenience: true when status is "completed" or "cancelled". */
  isDone: boolean;
}

const EMPTY: UseWorkflowResult = Object.freeze({
  workflow: undefined,
  currentStep: undefined,
  isActive: false,
  isDone: false,
});

/**
 * Subscribe to a single workflow by id. Returns the workflow plus convenience
 * accessors. Result is referentially stable when the underlying workflow
 * reference doesn't change.
 */
export function useWorkflow(workflowId: string): UseWorkflowResult {
  const workflow = useAgentSelector((s) => s.workflows.get(workflowId));
  return useMemo<UseWorkflowResult>(() => {
    if (!workflow) return EMPTY;
    return {
      workflow,
      currentStep: workflow.steps.find((s) => s.id === workflow.currentStepId),
      isActive: workflow.status === "active",
      isDone: workflow.status === "completed" || workflow.status === "cancelled",
    };
  }, [workflow]);
}
```

- [ ] **Step 4: Export from index**

Add to `packages/react/src/index.ts`:

```ts
export { useWorkflow } from "./use-workflow.js";
export type { UseWorkflowResult } from "./use-workflow.js";
export type { Workflow, WorkflowStep, WorkflowStatus, WorkflowStepStatus } from "./reducer.js";
export type {
  WorkflowEvent,
  WorkflowStartEvent,
  WorkflowAdvanceEvent,
  WorkflowCompleteEvent,
  WorkflowCancelEvent,
} from "@kibadist/agentui-protocol";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @kibadist/agentui-react test -- use-workflow`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/use-workflow.ts packages/react/src/index.ts packages/react/test/use-workflow.test.tsx
git commit -m "feat(react): useWorkflow hook (DET-155)"
```

---

### Task 5: `<WorkflowStepper>` component

**Files:**
- Create: `packages/react/src/workflow-stepper.tsx`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/test/workflow-stepper.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/test/workflow-stepper.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { createAgentStore } from "../src/store.js";
import { AgentStateProvider } from "../src/agent-state-context.js";
import { WorkflowStepper } from "../src/workflow-stepper.js";
import type { WorkflowStartEvent, WorkflowAdvanceEvent } from "@kibadist/agentui-protocol";

afterEach(cleanup);

const base = (id: string) => ({
  v: 1 as const,
  id,
  ts: "2026-05-19T00:00:00.000Z",
  sessionId: "s1",
});

function startEvt(): WorkflowStartEvent {
  return {
    ...base("e1"),
    op: "workflow.start",
    id: "wf1",
    steps: [
      { id: "a", title: "First" },
      { id: "b", title: "Second" },
    ],
  };
}

describe("WorkflowStepper", () => {
  it("renders nothing when workflow id is unknown and no fallback provided", () => {
    const store = createAgentStore();
    const { container } = render(
      <AgentStateProvider store={store}>
        <WorkflowStepper
          workflowId="nope"
          render={(wf) => <span>{wf.id}</span>}
        />
      </AgentStateProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("renders fallback when provided and id unknown", () => {
    const store = createAgentStore();
    const { getByTestId } = render(
      <AgentStateProvider store={store}>
        <WorkflowStepper
          workflowId="nope"
          render={(wf) => <span>{wf.id}</span>}
          fallback={() => <span data-testid="fb">empty</span>}
        />
      </AgentStateProvider>,
    );
    expect(getByTestId("fb").textContent).toBe("empty");
  });

  it("renders render(workflow) when workflow exists", () => {
    const store = createAgentStore();
    store.dispatch(startEvt());
    const { getByTestId } = render(
      <AgentStateProvider store={store}>
        <WorkflowStepper
          workflowId="wf1"
          render={(wf) => (
            <ul data-testid="steps">
              {wf.steps.map((s) => (
                <li key={s.id} data-status={s.status}>{s.title}</li>
              ))}
            </ul>
          )}
        />
      </AgentStateProvider>,
    );
    const ul = getByTestId("steps");
    const items = ul.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("data-status")).toBe("current");
    expect(items[1].getAttribute("data-status")).toBe("pending");
  });

  it("re-renders on workflow.advance", () => {
    const store = createAgentStore();
    store.dispatch(startEvt());
    const { getByTestId } = render(
      <AgentStateProvider store={store}>
        <WorkflowStepper
          workflowId="wf1"
          render={(wf) => (
            <span data-testid="current">{wf.currentStepId}</span>
          )}
        />
      </AgentStateProvider>,
    );
    expect(getByTestId("current").textContent).toBe("a");
    act(() => {
      const advance: WorkflowAdvanceEvent = {
        ...base("e2"),
        op: "workflow.advance",
        id: "wf1",
        stepId: "b",
      };
      store.dispatch(advance);
    });
    expect(getByTestId("current").textContent).toBe("b");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kibadist/agentui-react test -- workflow-stepper`
Expected: FAIL — `WorkflowStepper` not exported.

- [ ] **Step 3: Implement the component**

Create `packages/react/src/workflow-stepper.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { useWorkflow } from "./use-workflow.js";
import type { Workflow } from "./reducer.js";

export interface WorkflowStepperProps {
  workflowId: string;
  /** Render-prop. Receives the live Workflow. */
  render: (workflow: Workflow) => ReactNode;
  /** Optional: render when no workflow exists for `workflowId`. Default null. */
  fallback?: () => ReactNode;
}

/**
 * Render-prop component that subscribes to a workflow by id and delegates UI
 * to the caller. Pure presentational; emits no DOM beyond what `render` returns.
 */
export function WorkflowStepper(props: WorkflowStepperProps): JSX.Element {
  const { workflow } = useWorkflow(props.workflowId);
  if (!workflow) {
    return <>{props.fallback ? props.fallback() : null}</>;
  }
  return <>{props.render(workflow)}</>;
}
```

- [ ] **Step 4: Export from index**

Append to `packages/react/src/index.ts`:

```ts
export { WorkflowStepper } from "./workflow-stepper.js";
export type { WorkflowStepperProps } from "./workflow-stepper.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @kibadist/agentui-react test -- workflow-stepper`
Expected: PASS (4 tests).

- [ ] **Step 6: Full react suite + typecheck**

Run: `pnpm --filter @kibadist/agentui-react test && pnpm --filter @kibadist/agentui-react typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/workflow-stepper.tsx packages/react/src/index.ts packages/react/test/workflow-stepper.test.tsx
git commit -m "feat(react): WorkflowStepper render-prop component (DET-155)"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Append README "Workflows" subsection**

Insert (placement: after the existing "Reasoning streams" or similar slice docs, with 4-backtick outer fences since the example uses 3-backtick blocks inside):

````markdown
### Workflows / steppers

Multi-step wizards (onboarding, troubleshooting, multi-page forms) are first-class. The server emits a workflow lifecycle; the client subscribes by id and renders any UI.

```ts
// server
await stream.emit({
  op: "workflow.start",
  id: "onboard",
  steps: [
    { id: "profile",   title: "Your profile" },
    { id: "preferences", title: "Preferences" },
    { id: "confirm",   title: "Review" },
  ],
});

// ...later...
await stream.emit({ op: "workflow.advance", id: "onboard", stepId: "preferences" });
await stream.emit({ op: "workflow.complete", id: "onboard", result: { ok: true } });
```

```tsx
// client
import { WorkflowStepper, useWorkflow } from "@kibadist/agentui-react";

function Onboarding() {
  return (
    <WorkflowStepper
      workflowId="onboard"
      render={(wf) => (
        <ol>
          {wf.steps.map((s) => (
            <li key={s.id} data-status={s.status}>{s.title}</li>
          ))}
        </ol>
      )}
    />
  );
}

// Or use the hook directly:
function Header() {
  const { workflow, currentStep, isDone } = useWorkflow("onboard");
  if (!workflow) return null;
  return <h2>{isDone ? "Done" : currentStep?.title}</h2>;
}
```

`workflow.cancel` with optional `reason` terminates without a result. After `complete` or `cancel`, subsequent `advance`/`complete`/`cancel` events for the same workflow id are silently dropped.
````

- [ ] **Step 2: Update CHANGELOG**

Under the existing `## [Unreleased]` → `### Added` block, append:

```markdown
- Workflow primitive — protocol events `workflow.start` / `advance` / `complete` / `cancel`, `workflows` reducer slice, `useWorkflow(id)` hook, `<WorkflowStepper>` render-prop component. DET-155.
```

- [ ] **Step 3: Full monorepo verification**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: clean across all packages, no regressions.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: workflow/stepper primitive (DET-155)"
```
