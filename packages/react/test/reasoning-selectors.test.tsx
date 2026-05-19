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
