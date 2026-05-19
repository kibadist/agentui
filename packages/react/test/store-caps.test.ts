import { describe, it, expect, vi } from "vitest";
import { createAgentStore } from "../src/store.js";
import type { AgentAction } from "../src/reducer.js";

function appendNode(key: string): AgentAction {
  return {
    op: "ui.append",
    id: `e-${key}`,
    ts: new Date().toISOString(),
    sessionId: "s",
    node: { key, type: "text-block", props: { text: key } },
  };
}

function toast(id: string): AgentAction {
  return {
    op: "ui.toast",
    id,
    ts: new Date().toISOString(),
    sessionId: "s",
    level: "info",
    message: `m-${id}`,
  };
}

function toolStart(callId: string): AgentAction {
  return {
    op: "tool.start",
    id: callId,
    ts: new Date().toISOString(),
    sessionId: "s",
    name: "noop",
  };
}

function reasoningStart(rid: string): AgentAction {
  return {
    op: "reasoning.start",
    id: `e-${rid}`,
    ts: new Date().toISOString(),
    sessionId: "s",
    reasoningId: rid,
  };
}

describe("createAgentStore — caps", () => {
  it("evicts oldest nodes when maxNodes exceeded", () => {
    const onEvict = vi.fn();
    const store = createAgentStore({ caps: { maxNodes: 3, onEvict } });
    for (let i = 0; i < 5; i++) store.send(appendNode(`n${i}`));
    expect(store.getState().nodes.length).toBe(3);
    expect(store.getState().nodes.map((n) => n.key)).toEqual(["n2", "n3", "n4"]);
    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(onEvict.mock.calls[0]).toEqual(["nodes", [expect.objectContaining({ key: "n0" })]]);
  });

  it("evicts oldest toasts when maxToasts exceeded", () => {
    const onEvict = vi.fn();
    const store = createAgentStore({ caps: { maxToasts: 2, onEvict } });
    for (let i = 0; i < 5; i++) store.send(toast(`t${i}`));
    expect(store.getState().toasts.length).toBe(2);
    expect(onEvict).toHaveBeenCalledTimes(3);
  });

  it("evicts oldest tool calls when maxToolCalls exceeded", () => {
    const onEvict = vi.fn();
    const store = createAgentStore({ caps: { maxToolCalls: 2, onEvict } });
    for (let i = 0; i < 4; i++) store.send(toolStart(`tc${i}`));
    const s = store.getState();
    expect(s.toolCalls.size).toBe(2);
    expect(s.toolCallsOrder).toEqual(["tc2", "tc3"]);
    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(onEvict.mock.calls[0][0]).toBe("toolCalls");
  });

  it("evicts oldest reasoning segments when maxReasoning exceeded", () => {
    const onEvict = vi.fn();
    const store = createAgentStore({ caps: { maxReasoning: 2, onEvict } });
    for (let i = 0; i < 4; i++) store.send(reasoningStart(`r${i}`));
    const s = store.getState();
    expect(s.reasoning.size).toBe(2);
    expect(s.reasoningOrder).toEqual([`e-r2`, `e-r3`]);
    expect(onEvict).toHaveBeenCalledTimes(2);
  });

  it("preserves existing 50-toast default when caps unset", () => {
    const store = createAgentStore();
    for (let i = 0; i < 60; i++) store.send(toast(`t${i}`));
    expect(store.getState().toasts.length).toBe(50);
  });

  it("rebuilds byKey after node eviction", () => {
    const store = createAgentStore({ caps: { maxNodes: 2 } });
    store.send(appendNode("a"));
    store.send(appendNode("b"));
    store.send(appendNode("c"));
    const s = store.getState();
    expect(s.byKey.get("a")).toBeUndefined();
    expect(s.byKey.get("b")).toBe(0);
    expect(s.byKey.get("c")).toBe(1);
  });

  it("no eviction when caps undefined or Infinity", () => {
    const store = createAgentStore({ caps: { maxNodes: Infinity } });
    for (let i = 0; i < 1000; i++) store.send(appendNode(`n${i}`));
    expect(store.getState().nodes.length).toBe(1000);
  });
});
