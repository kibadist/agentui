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
