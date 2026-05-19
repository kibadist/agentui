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
    const second: WorkflowStartEvent = {
      ...start(),
      steps: [{ id: "x", title: "Different" }],
    };
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

  it("workflow.start with empty steps is a no-op", () => {
    const s0 = createInitialAgentState();
    const evt: WorkflowStartEvent = {
      ...base("e1"),
      op: "workflow.start",
      id: "wfempty",
      steps: [],
    };
    const s = agentReducer(s0, evt);
    expect(s.workflows).toBe(s0.workflows);
  });

  it("advance to the already-current step is a no-op", () => {
    const s0 = agentReducer(createInitialAgentState(), start());
    const s = agentReducer(s0, advance("a"));
    expect(s.workflows).toBe(s0.workflows);
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
