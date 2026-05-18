import { describe, it, expect } from "vitest";
import type {
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  UIAppendEvent,
} from "@kibadist/agentui-protocol";
import {
  agentReducer,
  createInitialAgentState,
  type AgentResetAction,
} from "../src/index.js";

// BaseEvent `id` is overloaded as the reasoning-segment id for reasoning events;
// events for the same segment share that id value.
function startEvent(id: string, turnId?: string): ReasoningStartEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "reasoning.start",
    turnId,
  };
}

function deltaEvent(id: string, delta: string): ReasoningDeltaEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "reasoning.delta",
    delta,
  };
}

function endEvent(id: string, tokens?: number): ReasoningEndEvent {
  return {
    v: 1,
    id,
    ts: "2026-01-01T00:00:01Z",
    sessionId: "s1",
    op: "reasoning.end",
    tokens,
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

describe("agentReducer — reasoning events", () => {
  it("start → delta → delta → end produces accumulated text and done status", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, startEvent("r1", "turn-1"));
    s = agentReducer(s, deltaEvent("r1", "Thinking "));
    s = agentReducer(s, deltaEvent("r1", "about it..."));
    s = agentReducer(s, endEvent("r1", 64));

    const seg = s.reasoning.get("r1");
    expect(seg).toBeDefined();
    expect(seg!.text).toBe("Thinking about it...");
    expect(seg!.status).toBe("done");
    expect(seg!.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(seg!.endedAt).toBe("2026-01-01T00:00:01Z");
    expect(seg!.tokens).toBe(64);
    expect(seg!.turnId).toBe("turn-1");
    expect(s.reasoningOrder).toEqual(["r1"]);
  });

  it("reasoning.delta for an unknown id is a silent no-op", () => {
    const s0 = createInitialAgentState();
    const s1 = agentReducer(s0, deltaEvent("nonexistent", "junk"));
    expect(s1).toBe(s0);
  });

  it("reasoning.end after another reasoning.end is a silent no-op", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, startEvent("r2"));
    s = agentReducer(s, endEvent("r2"));
    const afterFirstEnd = s;
    s = agentReducer(s, endEvent("r2"));
    expect(s).toBe(afterFirstEnd);
    expect(s.reasoning.get("r2")!.status).toBe("done");
  });

  it("__reset__ clears reasoning slice along with everything else", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, appendEvent("n1"));
    s = agentReducer(s, startEvent("r3"));
    const reset: AgentResetAction = { op: "__reset__" };
    s = agentReducer(s, reset);

    expect(s.reasoning.size).toBe(0);
    expect(s.reasoningOrder).toEqual([]);
    expect(s.nodes).toEqual([]);
  });
});
