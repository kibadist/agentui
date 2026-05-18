import { describe, it, expect } from "vitest";
import type {
  UIAppendEvent,
  UINavigateEvent,
  UIResetEvent,
  UIToastEvent,
} from "@kibadist/agentui-protocol";
import {
  agentReducer,
  createInitialAgentState,
  initialAgentState,
  type AgentResetAction,
} from "../src/index.js";

function appendEvent(key: string, type = "test.node"): UIAppendEvent {
  return {
    v: 1,
    id: `evt-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.append",
    node: { key, type, props: {} },
  };
}

function resetEvent(): UIResetEvent {
  return {
    v: 1,
    id: "evt-reset",
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.reset",
  };
}

const localReset: AgentResetAction = { op: "__reset__" };

describe("agentReducer — reset", () => {
  it("__reset__ returns a fresh byKey Map each call (no aliasing)", () => {
    // Anchor regression: createInitialAgentState() must hand back a new Map
    // every time. If it ever returned the module-level constant, two
    // post-reset states would share a Map and appending into one would
    // leak into the other.
    let s1 = createInitialAgentState();
    s1 = agentReducer(s1, appendEvent("a"));
    s1 = agentReducer(s1, localReset);
    s1 = agentReducer(s1, appendEvent("b"));

    let s2 = createInitialAgentState();
    s2 = agentReducer(s2, appendEvent("c"));
    s2 = agentReducer(s2, localReset);
    s2 = agentReducer(s2, appendEvent("d"));

    expect(s1.byKey).not.toBe(s2.byKey);
    expect(s1.nodes).not.toBe(s2.nodes);
    expect([...s1.byKey.keys()]).toEqual(["b"]);
    expect([...s2.byKey.keys()]).toEqual(["d"]);
  });

  it("ui.reset (wire event) clears state the same way as __reset__", () => {
    let viaWire = createInitialAgentState();
    viaWire = agentReducer(viaWire, appendEvent("a"));
    viaWire = agentReducer(viaWire, resetEvent());

    let viaLocal = createInitialAgentState();
    viaLocal = agentReducer(viaLocal, appendEvent("a"));
    viaLocal = agentReducer(viaLocal, localReset);

    expect(viaWire.nodes).toEqual([]);
    expect(viaWire.toasts).toEqual([]);
    expect(viaWire.navigate).toBeNull();
    expect(viaWire.byKey.size).toBe(0);
    // Both paths produce structurally equivalent state.
    expect(viaWire.nodes).toEqual(viaLocal.nodes);
    expect(viaWire.toasts).toEqual(viaLocal.toasts);
  });

  it("reset clears a pending navigate (stale intent)", () => {
    const nav: UINavigateEvent = {
      v: 1,
      id: "n",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "ui.navigate",
      href: "/foo",
    };
    let s = createInitialAgentState();
    s = agentReducer(s, nav);
    expect(s.navigate).toEqual({ href: "/foo", replace: undefined });

    s = agentReducer(s, localReset);
    expect(s.navigate).toBeNull();
  });

  it("reset clears accumulated toasts", () => {
    const toast: UIToastEvent = {
      v: 1,
      id: "t",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "ui.toast",
      level: "info",
      message: "hi",
    };
    let s = createInitialAgentState();
    s = agentReducer(s, toast);
    expect(s.toasts.length).toBe(1);

    s = agentReducer(s, localReset);
    expect(s.toasts).toEqual([]);
  });

  it("reset on already-empty state returns a fresh ref (not the same object)", () => {
    // Stance: always-fresh. Simpler invariant than "ref-equal when empty".
    const before = createInitialAgentState();
    const after = agentReducer(before, localReset);
    expect(after).not.toBe(before);
    expect(after.byKey).not.toBe(before.byKey);
    expect(after.nodes).not.toBe(before.nodes);
  });
});

describe("agentReducer — sanity", () => {
  it("append → state has node and byKey index", () => {
    const s = agentReducer(createInitialAgentState(), appendEvent("a"));
    expect(s.nodes).toHaveLength(1);
    expect(s.byKey.get("a")).toBe(0);
  });

  it("initialAgentState constant (deprecated) is structurally empty", () => {
    expect(initialAgentState.nodes).toEqual([]);
    expect(initialAgentState.toasts).toEqual([]);
    expect(initialAgentState.navigate).toBeNull();
  });
});
