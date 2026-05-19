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
      store.send(start());
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
      store.send(start());
    });
    const { result } = renderHook(() => useWorkflow("wf1"), { wrapper });
    act(() => {
      store.send(advance("b"));
    });
    expect(result.current.currentStep?.id).toBe("b");
    act(() => {
      store.send({
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
      store.send(start());
    });
    const { result } = renderHook(() => useWorkflow("wf1"), { wrapper });
    const first = result.current;
    act(() => {
      store.send({
        ...base("e2"),
        op: "ui.toast",
        level: "info",
        message: "x",
      });
    });
    expect(result.current).toBe(first);
  });
});
