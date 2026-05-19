import { describe, it, expect } from "vitest";
import { safeParseAgentEvent } from "../src/index.js";

describe("safeParseAgentEvent — optimistic events", () => {
  it("round-trips a valid optimistic.apply with ttlMs", () => {
    const raw = {
      v: 1,
      id: "evt-apply-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.apply",
      entityKey: "quote:q-123",
      patch: { status: "confirmed" },
      originId: "origin-1",
      ttlMs: 5000,
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "optimistic.apply") {
      expect(result.value.entityKey).toBe("quote:q-123");
      expect(result.value.patch).toEqual({ status: "confirmed" });
      expect(result.value.originId).toBe("origin-1");
      expect(result.value.ttlMs).toBe(5000);
    }
  });

  it("round-trips a valid optimistic.apply without ttlMs", () => {
    const raw = {
      v: 1,
      id: "evt-apply-2",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.apply",
      entityKey: "quote:q-456",
      patch: {},
      originId: "origin-2",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "optimistic.apply") {
      expect(result.value.ttlMs).toBeUndefined();
    }
  });

  it("round-trips a valid optimistic.confirm", () => {
    const raw = {
      v: 1,
      id: "evt-confirm-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.confirm",
      originId: "origin-1",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "optimistic.confirm") {
      expect(result.value.originId).toBe("origin-1");
    }
  });

  it("round-trips a valid optimistic.rollback", () => {
    const raw = {
      v: 1,
      id: "evt-rollback-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.rollback",
      originId: "origin-1",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
  });

  it("rejects an optimistic.apply missing entityKey", () => {
    const raw = {
      v: 1,
      id: "evt-bad",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "optimistic.apply",
      patch: { x: 1 },
      originId: "origin-bad",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });
});
