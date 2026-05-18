import { describe, it, expect } from "vitest";
import type {
  UIAppendEvent,
  UINavigateEvent,
  UIRemoveEvent,
  UIReplaceEvent,
  UIToastEvent,
  UIEvent,
} from "@kibadist/agentui-protocol";
import { createInitialAgentState } from "../../src/index.js";
import { pushEvent, replayConversation } from "../../src/testing/replay.js";

function appendEvent(key: string): UIAppendEvent {
  return { v: 1, id: `evt-a-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.append", node: { key, type: "test.node", props: {} } };
}
function replaceEvent(key: string, props: Record<string, unknown>): UIReplaceEvent {
  return { v: 1, id: `evt-r-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.replace", key, props };
}
function removeEvent(key: string): UIRemoveEvent {
  return { v: 1, id: `evt-x-${key}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.remove", key };
}
function toastEvent(message: string): UIToastEvent {
  return { v: 1, id: `evt-t-${message}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.toast", level: "info", message };
}
function navigateEvent(href: string): UINavigateEvent {
  return { v: 1, id: `evt-n-${href}`, ts: "2026-01-01T00:00:00Z", sessionId: "s1", op: "ui.navigate", href };
}

describe("pushEvent", () => {
  it("runs one event through the reducer and returns a fresh state reference", () => {
    const s0 = createInitialAgentState();
    const s1 = pushEvent(s0, appendEvent("a"));
    expect(s1.nodes).toHaveLength(1);
    expect(s1.nodes[0].key).toBe("a");
    expect(s1).not.toBe(s0);
  });
});

describe("replayConversation", () => {
  it("folds a 10-event mixed sequence to the expected state", () => {
    const events: UIEvent[] = [
      appendEvent("a"),
      appendEvent("b"),
      appendEvent("c"),
      replaceEvent("b", { x: 1 }),
      toastEvent("hello"),
      appendEvent("d"),
      removeEvent("a"),
      toastEvent("world"),
      navigateEvent("/dashboard"),
      replaceEvent("d", { y: 2 }),
    ];

    const state = replayConversation(events);

    expect(state.nodes.map((n) => n.key)).toEqual(["b", "c", "d"]);
    expect(state.byKey.get("b")).toBe(0);
    expect(state.byKey.get("c")).toBe(1);
    expect(state.byKey.get("d")).toBe(2);
    expect(state.toasts.map((t) => t.message)).toEqual(["hello", "world"]);
    expect(state.navigate).toEqual({ href: "/dashboard", replace: undefined });
  });

  it("returns the empty initial state for an empty event list", () => {
    const state = replayConversation([]);
    expect(state.nodes).toEqual([]);
    expect(state.toasts).toEqual([]);
    expect(state.navigate).toBeNull();
  });
});
