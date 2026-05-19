import { describe, it, expect } from "vitest";
import { agentReducer, createInitialAgentState } from "../src/reducer.js";
import type { SessionInitEvent, UIToastEvent, UIResetEvent } from "@kibadist/agentui-protocol";

const baseFields = { v: 1 as const, id: "e", ts: "t", sessionId: "s" };

function initEvent(perms: string[]): SessionInitEvent {
  return {
    ...baseFields,
    op: "session.init",
    capabilities: {
      nodeTypes: ["Card"],
      actions: ["confirm"],
      permissions: perms,
    },
  };
}

describe("agentReducer — session.init / capabilities", () => {
  it("initial state has declared=false and empty sets", () => {
    const s = createInitialAgentState();
    expect(s.capabilities.declared).toBe(false);
    expect(s.capabilities.nodeTypes.size).toBe(0);
    expect(s.capabilities.actions.size).toBe(0);
    expect(s.capabilities.permissions.size).toBe(0);
  });

  it("session.init populates capabilities and sets declared=true", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, initEvent(["quotes.write", "clients.read"]));
    expect(s.capabilities.declared).toBe(true);
    expect(s.capabilities.nodeTypes.has("Card")).toBe(true);
    expect(s.capabilities.actions.has("confirm")).toBe(true);
    expect(s.capabilities.permissions.has("quotes.write")).toBe(true);
    expect(s.capabilities.permissions.has("clients.read")).toBe(true);
  });

  it("a second session.init OVERWRITES (not merges)", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, initEvent(["quotes.write"]));
    s = agentReducer(s, initEvent(["clients.read"]));
    expect(Array.from(s.capabilities.permissions)).toEqual(["clients.read"]);
  });

  it("ui.reset preserves capabilities", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, initEvent(["quotes.write"]));
    const caps = s.capabilities;
    const reset: UIResetEvent = { ...baseFields, op: "ui.reset" };
    s = agentReducer(s, reset);
    expect(s.capabilities).toBe(caps);
  });

  it("unrelated dispatches keep capabilities referentially equal", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, initEvent(["quotes.write"]));
    const caps = s.capabilities;
    const toast: UIToastEvent = { ...baseFields, op: "ui.toast", level: "info", message: "hi" };
    s = agentReducer(s, toast);
    expect(s.capabilities).toBe(caps);
  });
});
