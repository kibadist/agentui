import { describe, it, expect, vi } from "vitest";
import { createAgentStore } from "../../src/store.js";
import type { AgentAction } from "../../src/reducer.js";

const append = (key: string): AgentAction => ({
  op: "ui.append",
  id: `e-${key}`,
  ts: new Date().toISOString(),
  sessionId: "s-1",
  node: { key, type: "text-block", props: { text: "hi" } },
});

describe("AgentStore.subscribeAction", () => {
  it("notifies listeners with (action, nextState, dispatchMs) after non-no-op send", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    store.subscribeAction(listener);

    const a = append("k1");
    store.send(a);

    expect(listener).toHaveBeenCalledTimes(1);
    const [action, nextState, dispatchMs] = listener.mock.calls[0]!;
    expect(action).toBe(a);
    expect(nextState.nodes).toHaveLength(1);
    expect(nextState.nodes[0].key).toBe("k1");
    expect(typeof dispatchMs).toBe("number");
    expect(dispatchMs).toBeGreaterThanOrEqual(0);
  });

  it("notifies action listeners on no-op (unknown key replace)", () => {
    // v1.1: action listeners fire on every dispatched action, including
    // no-ops where the reducer returned the same state reference.
    const store = createAgentStore();
    const listener = vi.fn();
    store.subscribeAction(listener);

    const action: AgentAction = {
      op: "ui.replace",
      id: "e-1",
      ts: new Date().toISOString(),
      sessionId: "s-1",
      key: "does-not-exist",
      props: { text: "x" },
    };
    store.send(action);

    expect(listener).toHaveBeenCalledTimes(1);
    const [seenAction, seenState] = listener.mock.calls[0]!;
    expect(seenAction).toBe(action);
    expect(seenState.nodes).toHaveLength(0);
  });

  it("notifies action listeners on unknown ops (host-signal pattern)", () => {
    // The host-signal pattern: consumers emit project-local ops the reducer
    // doesn't understand. The reducer's default branch returns state
    // unchanged; action listeners observe the dispatch.
    const store = createAgentStore();
    const listener = vi.fn();
    store.subscribeAction(listener);

    const action = {
      op: "host.signal" as AgentAction["op"],
      id: "e-host-1",
      ts: new Date().toISOString(),
      sessionId: "s-1",
      payload: { kind: "panelPatch", field: "totalPrice", value: 42 },
    } as unknown as AgentAction;
    store.send(action);

    expect(listener).toHaveBeenCalledTimes(1);
    const [seenAction, , dispatchMs] = listener.mock.calls[0]!;
    expect(seenAction).toBe(action);
    expect(typeof dispatchMs).toBe("number");
    expect(dispatchMs).toBeGreaterThanOrEqual(0);
  });

  it("does NOT notify state listeners on no-op (the optimization is preserved)", () => {
    const store = createAgentStore();
    const stateListener = vi.fn();
    const actionListener = vi.fn();
    store.subscribe(stateListener);
    store.subscribeAction(actionListener);

    // Two no-op shapes: known op that returns same-state ref + unknown op.
    store.send({
      op: "ui.replace",
      id: "e-1",
      ts: new Date().toISOString(),
      sessionId: "s-1",
      key: "does-not-exist",
      props: { text: "x" },
    });
    store.send({
      op: "host.signal" as AgentAction["op"],
      id: "e-2",
      ts: new Date().toISOString(),
      sessionId: "s-1",
    } as unknown as AgentAction);

    expect(stateListener).not.toHaveBeenCalled();
    expect(actionListener).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe removes the listener", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    const unsub = store.subscribeAction(listener);
    unsub();
    store.send(append("k2"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("state listeners and action listeners both fire on a state change", () => {
    const store = createAgentStore();
    const stateListener = vi.fn();
    const actionListener = vi.fn();
    store.subscribe(stateListener);
    store.subscribeAction(actionListener);

    store.send(append("k3"));
    expect(stateListener).toHaveBeenCalledTimes(1);
    expect(actionListener).toHaveBeenCalledTimes(1);
  });
});
