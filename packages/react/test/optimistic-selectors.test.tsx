import { describe, it, expect, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { OptimisticApplyEvent } from "@kibadist/agentui-protocol";
import {
  AgentStateProvider,
  createAgentStore,
  useOptimistic,
  useOptimisticAll,
} from "../src/index.js";

afterEach(cleanup);

function applyEvent(
  entityKey: string,
  patch: Record<string, unknown>,
  originId: string,
): OptimisticApplyEvent {
  return {
    v: 1,
    id: `evt-apply-${originId}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "optimistic.apply",
    entityKey,
    patch,
    originId,
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

describe("useOptimistic / useOptimisticAll", () => {
  it("useOptimistic(entityKey) returns the patch", () => {
    const store = createAgentStore();
    const probe = makeProbe(() => useOptimistic("quote:q1"));

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.lastValue()).toBeUndefined();

    act(() => {
      store.send(applyEvent("quote:q1", { status: "confirmed" }, "o1"));
    });
    expect(probe.lastValue()).toEqual({ status: "confirmed" });
  });

  it("useOptimistic(entityKey) does not re-render when an unrelated entityKey changes", () => {
    const store = createAgentStore();
    const probe = makeProbe(() => useOptimistic("quote:q1"));

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );
    expect(probe.renders()).toBe(1);

    act(() => {
      store.send(applyEvent("quote:q1", { x: 1 }, "o1"));
    });
    const rendersAfterQ1 = probe.renders();

    act(() => {
      store.send(applyEvent("quote:q2", { y: 2 }, "o2"));
    });
    expect(probe.renders()).toBe(rendersAfterQ1);
  });

  it("useOptimisticAll() returns the Map with insertion order preserved", () => {
    const store = createAgentStore();
    const probe = makeProbe(useOptimisticAll);

    render(
      <AgentStateProvider store={store}>
        <probe.Probe />
      </AgentStateProvider>,
    );

    act(() => {
      store.send(applyEvent("a", { a: 1 }, "oA"));
      store.send(applyEvent("b", { b: 1 }, "oB"));
      store.send(applyEvent("c", { c: 1 }, "oC"));
    });

    const keys = [...probe.lastValue()!.keys()];
    expect(keys).toEqual(["a", "b", "c"]);
  });
});
