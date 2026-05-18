import { describe, it, expect, vi } from "vitest";
import type { UIAppendEvent, UIToastEvent } from "@kibadist/agentui-protocol";
import { createAgentStore, createInitialAgentState } from "../src/index.js";

function appendEvent(key: string): UIAppendEvent {
  return {
    v: 1,
    id: `evt-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.append",
    node: { key, type: "test.node", props: {} },
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

describe("createAgentStore", () => {
  it("getState returns the initial state passed in (or empty default)", () => {
    const a = createAgentStore();
    expect(a.getState().nodes).toEqual([]);
    expect(a.getState().toasts).toEqual([]);

    const seeded = createInitialAgentState();
    seeded.nodes.push({ key: "a", type: "x", props: {} });
    const b = createAgentStore(seeded);
    expect(b.getState().nodes).toHaveLength(1);
  });

  it("send notifies subscribers when state changes", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.send(appendEvent("a"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further notifications", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    store.send(appendEvent("a"));
    unsub();
    store.send(appendEvent("b"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the reducer returns the same state (no-op action)", () => {
    const store = createAgentStore();
    const listener = vi.fn();
    store.subscribe(listener);
    // ui.replace for a key that doesn't exist is a documented no-op in agentReducer
    store.send({
      v: 1,
      id: "evt-r",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "ui.replace",
      key: "does-not-exist",
      props: {},
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("reset clears state and notifies subscribers", () => {
    const store = createAgentStore();
    store.send(appendEvent("a"));
    store.send(toastEvent("hi"));
    expect(store.getState().nodes).toHaveLength(1);
    expect(store.getState().toasts).toHaveLength(1);

    const listener = vi.fn();
    store.subscribe(listener);
    store.reset();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().nodes).toEqual([]);
    expect(store.getState().toasts).toEqual([]);
  });

  it("each listener sees the current state via getState (no stale reads)", () => {
    const store = createAgentStore();
    let seenLength = -1;
    store.subscribe(() => {
      seenLength = store.getState().nodes.length;
    });
    store.send(appendEvent("a"));
    expect(seenLength).toBe(1);
  });
});
