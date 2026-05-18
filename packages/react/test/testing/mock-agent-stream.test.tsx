import { describe, it, expect, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type {
  UIAppendEvent,
  UINavigateEvent,
  UIToastEvent,
} from "@kibadist/agentui-protocol";
import {
  AgentStateProvider,
  useAgentNodes,
} from "../../src/index.js";
import { createMockAgentStream } from "../../src/testing/mock-agent-stream.js";

afterEach(cleanup);

function appendEvent(key: string): UIAppendEvent {
  return { v: 1, id: `evt-a-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.append", node: { key, type: "test.node", props: {} } };
}
function toastEvent(message: string): UIToastEvent {
  return { v: 1, id: `evt-t-${message}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.toast", level: "info", message };
}
function navigateEvent(href: string): UINavigateEvent {
  return { v: 1, id: `evt-n-${href}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.navigate", href };
}

function NodesProbe() {
  const nodes = useAgentNodes();
  return <span data-testid="probe-nodes-count">{nodes.length}</span>;
}

describe("createMockAgentStream", () => {
  it("push() drives selector consumers via the provided store", () => {
    const mock = createMockAgentStream();

    const { getByTestId } = render(
      <AgentStateProvider store={mock.store}>
        <NodesProbe />
      </AgentStateProvider>,
    );
    expect(getByTestId("probe-nodes-count").textContent).toBe("0");

    act(() => {
      mock.push(appendEvent("a"));
      mock.push(appendEvent("b"));
    });

    expect(getByTestId("probe-nodes-count").textContent).toBe("2");
    expect(mock.state.nodes.map((n) => n.key)).toEqual(["a", "b"]);
  });

  it("hook() returns the same shape as useAgentStream and reacts to setStatus", () => {
    const mock = createMockAgentStream();

    function HookProbe() {
      const result = mock.hook();
      return (
        <>
          <span data-testid="probe-status">{result.status}</span>
          <span data-testid="probe-nodes">{result.state.nodes.length}</span>
          <span data-testid="probe-has-store">{result.store ? "yes" : "no"}</span>
        </>
      );
    }

    const { getByTestId } = render(<HookProbe />);
    expect(getByTestId("probe-status").textContent).toBe("idle");
    expect(getByTestId("probe-nodes").textContent).toBe("0");
    expect(getByTestId("probe-has-store").textContent).toBe("yes");

    act(() => {
      mock.setStatus("open");
    });
    expect(getByTestId("probe-status").textContent).toBe("open");

    act(() => {
      mock.push(appendEvent("a"));
    });
    expect(getByTestId("probe-nodes").textContent).toBe("1");
  });

  it("history records every dispatched action in order (push, dispatchInternal, reset)", () => {
    const mock = createMockAgentStream();

    mock.push(appendEvent("a"));
    mock.push(toastEvent("hello"));
    mock.dispatchInternal({ op: "__reset__" });
    mock.push(navigateEvent("/foo"));

    expect(mock.history).toHaveLength(4);
    expect(mock.history[0].op).toBe("ui.append");
    expect(mock.history[1].op).toBe("ui.toast");
    expect(mock.history[2].op).toBe("__reset__");
    expect(mock.history[3].op).toBe("ui.navigate");
  });

  it("state is a live getter — reads outside React reflect current state", () => {
    const mock = createMockAgentStream();
    expect(mock.state.nodes).toHaveLength(0);

    mock.push(appendEvent("a"));
    expect(mock.state.nodes).toHaveLength(1);

    mock.reset();
    expect(mock.state.nodes).toHaveLength(0);
  });
});
