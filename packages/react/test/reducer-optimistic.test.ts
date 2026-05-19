import { describe, it, expect } from "vitest";
import type {
  OptimisticApplyEvent,
  OptimisticConfirmEvent,
  OptimisticRollbackEvent,
} from "@kibadist/agentui-protocol";
import {
  agentReducer,
  createInitialAgentState,
  type AgentResetAction,
} from "../src/index.js";

function applyEvent(
  entityKey: string,
  patch: Record<string, unknown>,
  originId: string,
  ttlMs?: number,
): OptimisticApplyEvent {
  return {
    v: 1,
    id: `evt-apply-${originId}`,
    ts: "2026-01-01T00:00:00Z",
    sessionId: "s1",
    op: "optimistic.apply",
    entityKey,
    patch,
    originId,
    ttlMs,
  };
}

function confirmEvent(originId: string): OptimisticConfirmEvent {
  return {
    v: 1,
    id: `evt-confirm-${originId}`,
    ts: "2026-01-01T00:00:01Z",
    sessionId: "s1",
    op: "optimistic.confirm",
    originId,
  };
}

function rollbackEvent(originId: string): OptimisticRollbackEvent {
  return {
    v: 1,
    id: `evt-rollback-${originId}`,
    ts: "2026-01-01T00:00:01Z",
    sessionId: "s1",
    op: "optimistic.rollback",
    originId,
  };
}

describe("agentReducer — optimistic events", () => {
  it("apply → confirm clears the entry", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q1", { status: "confirmed" }, "o1"));
    expect(s.optimistic.get("quote:q1")?.patch).toEqual({ status: "confirmed" });

    s = agentReducer(s, confirmEvent("o1"));
    expect(s.optimistic.size).toBe(0);
  });

  it("apply → rollback clears the entry", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q2", { status: "x" }, "o2"));
    s = agentReducer(s, rollbackEvent("o2"));
    expect(s.optimistic.size).toBe(0);
  });

  it("apply A → apply B (same key) → confirm A is a silent no-op", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q3", { v: 1 }, "originA"));
    s = agentReducer(s, applyEvent("quote:q3", { v: 2 }, "originB"));
    const afterB = s;

    s = agentReducer(s, confirmEvent("originA"));
    expect(s).toBe(afterB);
    expect(s.optimistic.get("quote:q3")?.originId).toBe("originB");
    expect(s.optimistic.get("quote:q3")?.patch).toEqual({ v: 2 });
  });

  it("__reset__ clears all optimistic entries", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q4", { x: 1 }, "o4"));
    s = agentReducer(s, applyEvent("job:j1", { x: 2 }, "o5"));
    expect(s.optimistic.size).toBe(2);

    const reset: AgentResetAction = { op: "__reset__" };
    s = agentReducer(s, reset);
    expect(s.optimistic.size).toBe(0);
  });

  it("expiresAt is computed from ttlMs and applied ts", () => {
    let s = createInitialAgentState();
    s = agentReducer(s, applyEvent("quote:q5", { x: 1 }, "o6", 5000));
    const entry = s.optimistic.get("quote:q5");
    expect(entry).toBeDefined();
    expect(entry!.appliedAt).toBe("2026-01-01T00:00:00Z");
    expect(entry!.expiresAt).toBe("2026-01-01T00:00:05.000Z");
  });
});
