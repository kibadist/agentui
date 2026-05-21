import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentDevToolsRecorder } from "../../src/devtools/recorder.js";
import { createAgentStore } from "../../src/store.js";
import { AgentStateProvider } from "../../src/agent-state-context.js";
import type { ReactNode } from "react";
import type { AgentAction } from "../../src/reducer.js";

const append = (key: string): AgentAction => ({
  op: "ui.append",
  id: `e-${key}`,
  ts: new Date().toISOString(),
  sessionId: "s-1",
  node: { key, type: "text-block", props: { text: "x" } },
});

function makeWrapper(store: ReturnType<typeof createAgentStore>) {
  return ({ children }: { children: ReactNode }) => (
    <AgentStateProvider store={store}>{children}</AgentStateProvider>
  );
}

describe("useAgentDevToolsRecorder", () => {
  it("records each non-no-op event with monotonic seq and snapshot", async () => {
    const store = createAgentStore();
    const { result } = renderHook(() => useAgentDevToolsRecorder({ maxEvents: 100 }), {
      wrapper: makeWrapper(store),
    });

    expect(result.current.events).toHaveLength(0);

    act(() => {
      store.send(append("k1"));
      store.send(append("k2"));
      store.send(append("k3"));
    });

    // rAF flush
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    expect(result.current.events).toHaveLength(3);
    expect(result.current.events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(result.current.events[2].state.nodes).toHaveLength(3);
  });

  it("records no-op actions (unknown-key replace) with unchanged state", async () => {
    // v1.1: the store fires action listeners on every dispatch, including
    // no-ops. The recorder captures them so devs can see attempted dispatches
    // that didn't mutate state.
    const store = createAgentStore();
    const { result } = renderHook(() => useAgentDevToolsRecorder({ maxEvents: 100 }), {
      wrapper: makeWrapper(store),
    });

    act(() => {
      store.send({
        op: "ui.replace",
        id: "e-1",
        ts: new Date().toISOString(),
        sessionId: "s-1",
        key: "missing",
        props: { x: 1 },
      });
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].action.op).toBe("ui.replace");
    expect(result.current.events[0].state.nodes).toHaveLength(0);
  });

  it("evicts oldest when ring buffer is full, keeping seq monotonic", async () => {
    const store = createAgentStore();
    const { result } = renderHook(() => useAgentDevToolsRecorder({ maxEvents: 3 }), {
      wrapper: makeWrapper(store),
    });

    act(() => {
      for (let i = 0; i < 5; i++) store.send(append(`k${i}`));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    expect(result.current.events.map((e) => e.seq)).toEqual([2, 3, 4]);
  });

  it("snapshot at any point equals replayConversation of recorded actions", async () => {
    const { replayConversation } = await import("../../src/testing/replay.js");
    const store = createAgentStore();
    const { result } = renderHook(() => useAgentDevToolsRecorder({ maxEvents: 100 }), {
      wrapper: makeWrapper(store),
    });

    act(() => {
      store.send(append("a"));
      store.send(append("b"));
      store.send(append("c"));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const events = result.current.events;
    for (let i = 0; i < events.length; i++) {
      const slice = events.slice(0, i + 1).map((e) => e.action);
      const expected = replayConversation(slice as never);
      expect(events[i].state.nodes.map((n) => n.key)).toEqual(
        expected.nodes.map((n) => n.key),
      );
    }
  });
});
