import { describe, it, expect } from "vitest";
import type {
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ToolCallResultEvent,
  ToolCallCancelEvent,
  UIAppendEvent,
} from "@kibadist/agentui-protocol";
import {
  agentReducer,
  createInitialAgentState,
  type AgentResetAction,
} from "../src/index.js";

// In the tool-event protocol, BaseEvent's `id` field IS the tool-call id —
// events for the same tool call share that id. Comment in BaseEvent says
// "unique event id (uuid)" which is true for UI events but overloaded for
// tool events (the discriminant is `op`, the correlation key is `id`).
function startEvent(id: string, name: string, args?: unknown): ToolCallStartEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "tool.start",
    name,
    args,
  };
}

function deltaEvent(id: string, delta: string): ToolArgsDeltaEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "tool.args-delta",
    delta,
  };
}

function resultEvent(
  id: string,
  status: "ok" | "error",
  result?: unknown,
  durationMs?: number,
): ToolCallResultEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:01Z",
    sessionId: "s1",
    op: "tool.result",
    status,
    result,
    durationMs,
  };
}

function cancelEvent(id: string): ToolCallCancelEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:02Z",
    sessionId: "s1",
    op: "tool.cancel",
  };
}

function appendEvent(key: string): UIAppendEvent {
  return {
    v: 1,
    id: `evt-a-${key}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "ui.append",
    node: { key, type: "test.node", props: {} },
  };
}

describe("agentReducer — tool events", () => {
  it("start → args-delta → args-delta → result lands with parsed args", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, startEvent("t1", "search"));
    s = agentReducer(s, deltaEvent("t1", '{"q":'));
    s = agentReducer(s, deltaEvent("t1", '"hi"}'));
    s = agentReducer(s, resultEvent("t1", "ok", { items: [] }, 42));

    const tc = s.toolCalls.get("t1");
    expect(tc).toBeDefined();
    expect(tc!.status).toBe("ok");
    expect(tc!.args).toEqual({ q: "hi" });
    expect(tc!.argsRaw).toBe('{"q":"hi"}');
    expect(tc!.result).toEqual({ items: [] });
    expect(tc!.durationMs).toBe(42);
    expect(tc!.endedAt).toBe("2026-01-01T00:00:01Z");
    expect(s.toolCallsOrder).toEqual(["t1"]);
  });

  it("cancel before result; later result is silently ignored", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, startEvent("t2", "x"));
    s = agentReducer(s, cancelEvent("t2"));
    const afterCancel = s;
    s = agentReducer(s, resultEvent("t2", "ok"));

    expect(s.toolCalls.get("t2")!.status).toBe("cancelled");
    expect(s.toolCalls.get("t2")!.endedAt).toBe("2026-01-01T00:00:02Z");
    expect(s).toBe(afterCancel);
  });

  it("__reset__ clears tool calls along with everything else", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, appendEvent("n1"));
    s = agentReducer(s, startEvent("t3", "x"));
    const reset: AgentResetAction = { op: "__reset__" };
    s = agentReducer(s, reset);

    expect(s.toolCalls.size).toBe(0);
    expect(s.toolCallsOrder).toEqual([]);
    expect(s.nodes).toEqual([]);
  });

  it("tool.args-delta for an unknown id is a silent no-op", () => {
    const s0 = createInitialAgentState();
    const s1 = agentReducer(s0, deltaEvent("nonexistent", "junk"));
    expect(s1).toBe(s0);
  });
});
