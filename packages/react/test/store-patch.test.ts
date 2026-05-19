import { describe, it, expect, vi } from "vitest";
import { createAgentStore } from "../src/store.js";
import type { UIAppendEvent, UIReplaceEvent } from "@kibadist/agentui-protocol";

function append(key: string, props: Record<string, unknown>): UIAppendEvent {
  return {
    v: 1, id: `a-${key}`, ts: "t", sessionId: "s",
    op: "ui.append",
    node: { key, type: "Card", props },
  };
}

function patch(key: string, ops: { op: "replace"; path: string; value: unknown }[] | { op: "test"; path: string; value: unknown }[] | { op: "remove"; path: string }[]): UIReplaceEvent {
  return {
    v: 1, id: `r-${key}`, ts: "t", sessionId: "s",
    op: "ui.replace", key, patch: ops,
  } as UIReplaceEvent;
}

describe("createAgentStore — JSON Patch pre-apply", () => {
  it("applies patch to existing node's props", () => {
    const store = createAgentStore();
    store.send(append("n1", { items: [{ status: "todo" }, { status: "todo" }, { status: "todo" }] }));
    store.send(patch("n1", [{ op: "replace", path: "/items/1/status", value: "done" }]));
    const state = store.getState();
    expect(state.nodes[0].props).toEqual({
      items: [{ status: "todo" }, { status: "done" }, { status: "todo" }],
    });
  });

  it("calls onPatchFailure on semantic failure and leaves state unchanged", () => {
    const onPatchFailure = vi.fn();
    const store = createAgentStore({ onPatchFailure });
    store.send(append("n1", { a: 1 }));
    const evt = patch("n1", [{ op: "test", path: "/a", value: 999 }]);
    store.send(evt);
    expect(onPatchFailure).toHaveBeenCalledTimes(1);
    expect(onPatchFailure.mock.calls[0][0]).toBe(evt);
    expect(store.getState().nodes[0].props).toEqual({ a: 1 });
  });

  it("is a silent no-op when the key is not in state", () => {
    const onPatchFailure = vi.fn();
    const store = createAgentStore({ onPatchFailure });
    store.send(patch("missing", [{ op: "replace", path: "/a", value: 1 }]));
    expect(onPatchFailure).not.toHaveBeenCalled();
    expect(store.getState().nodes).toEqual([]);
  });

  it("does not throw when onPatchFailure is undefined", () => {
    const store = createAgentStore();
    store.send(append("n1", { a: 1 }));
    expect(() =>
      store.send(patch("n1", [{ op: "test", path: "/a", value: 999 }])),
    ).not.toThrow();
  });

  it("mixed props/patch sequence converges correctly", () => {
    const store = createAgentStore();
    store.send(append("n1", { a: 1, b: 2 }));
    store.send({
      v: 1, id: "r1", ts: "t", sessionId: "s",
      op: "ui.replace", key: "n1", props: { c: 3 },
    } as UIReplaceEvent);
    store.send(patch("n1", [{ op: "remove", path: "/a" }]));
    expect(store.getState().nodes[0].props).toEqual({ b: 2, c: 3 });
  });
});
