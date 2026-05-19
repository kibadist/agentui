---
ticket: DET-155
title: Workflow / stepper node primitive (multi-step wizard)
version_target: 0.9.x (initial publish at current monorepo version)
date: 2026-05-19
---

# Workflow / Stepper — Design Spec

## 1. Goal

Ship a first-class workflow primitive so consumers don't reinvent the multi-step state machine. Server emits `workflow.start` / `advance` / `complete` / `cancel`; the reducer maintains a `workflows` slice; clients render via `<WorkflowStepper>` + `useWorkflow(id)`.

This mirrors the existing tool-call and reasoning slices in shape and discipline.

## 2. Wire protocol

Four new events in the `workflow.*` namespace.

```ts
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
  /** Optional cancellation reason (human or machine). */
  reason?: string;
}

export type WorkflowEvent =
  | WorkflowStartEvent
  | WorkflowAdvanceEvent
  | WorkflowCompleteEvent
  | WorkflowCancelEvent;
```

`AgentWireEvent` widens to include `WorkflowEvent`.

### Validation constraints

- `id`, `stepId`, step `id`, `title`, `nodeKey`: `string().min(1).max(256)`.
- `steps`: `array().min(1).max(64)`.
- Duplicate step `id`s within a workflow's `steps[]`: REJECTED (validate-level superRefine).
- `result`, `reason`: pass-through (any shape; result is `z.unknown()`, reason is `z.string().max(1024).optional()`).

## 3. Reducer state

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
  startedAt: string;        // from workflow.start ts
  endedAt?: string;         // set on complete or cancel
}

interface AgentState {
  // ...existing
  workflows: Map<string, Workflow>;
}
```

Initial value: empty `Map`.

### Reducer rules

**`workflow.start`:**
- If id already in state, silent no-op (idempotent; duplicate start dropped).
- Otherwise: new `Workflow` with `status: "active"`, `currentStepId: steps[0].id`. Step[0] gets `status: "current"`; all others `"pending"`.

**`workflow.advance`:**
- If id not in state or `workflow.status !== "active"`, silent no-op.
- If `stepId` is NOT in the workflow's step ids, silent no-op (treated as malformed; logged via `onInvalidEvent` upstream is the wire-validate layer's job, not the reducer's).
- Otherwise: rebuild step statuses — all steps before target → `"completed"`; target → `"current"`; all steps after → `"pending"`. Update `currentStepId`. **Backwards advance allowed.** Steps that were previously `"skipped"` keep their `"skipped"` status only if they are now *before* the new current. Simpler rule: recompute all statuses purely from index relative to target; ignore prior status. (Skipped semantics are deferred — not in v0.9.)
- Refined: recompute pos = indexOf(stepId). For each step i: i < pos → `"completed"`; i === pos → `"current"`; i > pos → `"pending"`.

**`workflow.complete`:**
- If id not in state or `status !== "active"`, no-op.
- Otherwise: `status = "completed"`, `result = e.result`, `endedAt = e.ts`. Leave step statuses untouched (caller can interpret).

**`workflow.cancel`:**
- If id not in state or `status !== "active"`, no-op.
- Otherwise: `status = "cancelled"`, `reason = e.reason`, `endedAt = e.ts`.

**`ui.reset` / `__reset__`:**
- Clears workflows (new empty `Map`). Consistent with how the reset path clears nodes/toolCalls/reasoning.

**Selector stability:** non-workflow actions return the SAME `workflows` reference; workflow actions return a new `Map`. Tested explicitly.

## 4. `useWorkflow` hook

```ts
export interface UseWorkflowResult {
  workflow: Workflow | undefined;
  /** Convenience: the current step. */
  currentStep: WorkflowStep | undefined;
  /** Convenience: true when status === "active". */
  isActive: boolean;
  /** Convenience: true when status is a terminal state. */
  isDone: boolean;
}

export function useWorkflow(workflowId: string): UseWorkflowResult;
```

Returns a memoized object; stable when the underlying `Workflow` reference is stable.

## 5. `<WorkflowStepper>` component

```ts
export interface WorkflowStepperProps {
  workflowId: string;
  /** Render-prop. Receives the live Workflow. */
  render: (workflow: Workflow) => ReactNode;
  /** Optional: render when no workflow exists for `workflowId`. Default null. */
  fallback?: () => ReactNode;
}

export function WorkflowStepper(props: WorkflowStepperProps): JSX.Element;
```

Pure presentational — gets the workflow via `useWorkflow`, calls `render(workflow)` or `fallback()`. The component itself emits no styling and no DOM beyond what `render` returns.

## 6. File layout

```
packages/protocol/src/index.ts                      # MODIFY — Workflow* events + union widen
packages/validate/src/schemas.ts                    # MODIFY — workflow*Schema + AgentWireEvent union widen
packages/react/src/reducer.ts                       # MODIFY — Workflow types, workflows slice, 4 applyWorkflow* + reset clear
packages/react/src/use-workflow.ts                  # NEW — hook
packages/react/src/workflow-stepper.tsx             # NEW — render-prop component
packages/react/src/index.ts                         # MODIFY — exports

packages/validate/test/workflow.test.ts             # NEW
packages/react/test/reducer-workflow.test.ts        # NEW
packages/react/test/use-workflow.test.tsx           # NEW
packages/react/test/workflow-stepper.test.tsx       # NEW
```

## 7. Public exports (additions)

From `@kibadist/agentui-react`:
- `useWorkflow`, `WorkflowStepper`
- Types: `Workflow`, `WorkflowStep`, `WorkflowStatus`, `WorkflowStepStatus`, `UseWorkflowResult`, `WorkflowStepperProps`
- Re-exports of protocol types: `WorkflowStartEvent`, `WorkflowAdvanceEvent`, `WorkflowCompleteEvent`, `WorkflowCancelEvent`, `WorkflowEvent`

## 8. Tests

### 8.1 Validate (`workflow.test.ts`)
- Each event with valid shape parses; missing required field rejects.
- `workflow.start` with duplicate step ids rejects.
- `workflow.start` with empty `steps[]` rejects.

### 8.2 Reducer (`reducer-workflow.test.ts`)
- start → advance(step2) → complete: workflow ends with `status: "completed"`, step[0]=completed, step[1]=completed (target became current then completion freezes), step[2]=pending. (Note: `complete` doesn't touch step statuses; final snapshot is whatever advance left.)
- Actually: after `advance(step2)` (assuming 3 steps), statuses are step[0]=completed, step[1]=current, step[2]=pending. `complete` then flips workflow status to `completed` without touching steps.
- Backwards advance: start (3 steps), `advance(step3)`, `advance(step1)` — final statuses: step[0]=current, step[1]=pending, step[2]=pending.
- Cancel during active: status=cancelled, endedAt set, reason recorded.
- Post-cancel advance: no-op (workflow reference unchanged).
- Post-complete advance: no-op.
- Post-complete cancel: no-op.
- Unknown workflow advance: no-op (silent).
- Unknown stepId on advance: no-op.
- Duplicate `workflow.start`: idempotent — first wins, second is no-op (does NOT reset step statuses).
- `ui.reset` clears `workflows`.
- Non-workflow action returns SAME `workflows` reference.

### 8.3 useWorkflow (`use-workflow.test.tsx`)
- Returns `{ workflow, currentStep, isActive, isDone }` after `workflow.start`.
- `isActive: true` while active, `isDone: true` after complete/cancel.
- Returned object is referentially stable when an unrelated action dispatches (`ui.toast`).
- Returns `{ workflow: undefined, currentStep: undefined, isActive: false, isDone: false }` for unknown id.

### 8.4 WorkflowStepper (`workflow-stepper.test.tsx`)
- Renders `render(workflow)` output when workflow exists.
- Renders `null` for unknown id without `fallback`.
- Renders `fallback()` when supplied and id unknown.
- Re-renders on `workflow.advance` (step status reflects change in DOM).

## 9. Acceptance criteria

- `pnpm test` passes (4 new test files; no regressions).
- `pnpm typecheck` clean.
- `pnpm build` clean.
- README has a "Workflows" subsection with a minimal example showing `workflow.start` → `<WorkflowStepper>` → `workflow.advance`.
- CHANGELOG records DET-155 under `Unreleased` → `Added`.

## 10. Out of scope (deferred)

- Step `skipped` status semantics (the type exists but the reducer never sets it — caller-controlled via a future `workflow.skip` event).
- Branching workflows / step DAGs (steps are strictly linear).
- Server-driven step prefetching, conditional reveals, validation gating.
- A built-in stepper UI (the library ships logic + render-prop only; styling is host-supplied).
