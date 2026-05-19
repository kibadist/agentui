import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCapabilities } from "../src/use-capabilities.js";
import { AgentStateProvider } from "../src/agent-state-context.js";
import { createAgentStore } from "../src/store.js";
import type { SessionInitEvent, UIToastEvent } from "@kibadist/agentui-protocol";

const base = { v: 1 as const, id: "e", ts: "t", sessionId: "s" };

describe("useCapabilities", () => {
  it("returns empty sets and declared=false before session.init", () => {
    const store = createAgentStore();
    const { result } = renderHook(() => useCapabilities(), {
      wrapper: ({ children }) => (
        <AgentStateProvider store={store}>{children}</AgentStateProvider>
      ),
    });
    expect(result.current.declared).toBe(false);
    expect(result.current.permissions.size).toBe(0);
    expect(result.current.hasPermission("anything")).toBe(false);
    expect(result.current.canAct("anything")).toBe(false);
    expect(result.current.canEmit("anything")).toBe(false);
  });

  it("reflects session.init payload", () => {
    const store = createAgentStore();
    const { result } = renderHook(() => useCapabilities(), {
      wrapper: ({ children }) => (
        <AgentStateProvider store={store}>{children}</AgentStateProvider>
      ),
    });
    const evt: SessionInitEvent = {
      ...base,
      op: "session.init",
      capabilities: {
        nodeTypes: ["Card"],
        actions: ["confirm"],
        permissions: ["quotes.write"],
      },
    };
    act(() => {
      store.send(evt);
    });
    expect(result.current.declared).toBe(true);
    expect(result.current.hasPermission("quotes.write")).toBe(true);
    expect(result.current.hasPermission("nope")).toBe(false);
    expect(result.current.canAct("confirm")).toBe(true);
    expect(result.current.canEmit("Card")).toBe(true);
  });

  it("is referentially stable across unrelated dispatches", () => {
    const store = createAgentStore();
    const { result, rerender } = renderHook(() => useCapabilities(), {
      wrapper: ({ children }) => (
        <AgentStateProvider store={store}>{children}</AgentStateProvider>
      ),
    });
    const first = result.current;
    const toast: UIToastEvent = { ...base, op: "ui.toast", level: "info", message: "x" };
    act(() => store.send(toast));
    rerender();
    expect(result.current).toBe(first);
  });
});
