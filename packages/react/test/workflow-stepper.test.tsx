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
    store.send(startEvt());
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
    store.send(startEvt());
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
      store.send(advance);
    });
    expect(getByTestId("current").textContent).toBe("b");
  });
});
