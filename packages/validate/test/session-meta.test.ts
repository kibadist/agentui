import { describe, it, expect } from "vitest";
import { safeParseAgentEvent } from "../src/index.js";

describe("safeParseAgentEvent — session.meta", () => {
  it("round-trips a valid session.meta with conversationId", () => {
    const raw = {
      v: 1,
      id: "evt-meta-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "session.meta",
      conversationId: "conv-abc",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "session.meta") {
      expect(result.value.conversationId).toBe("conv-abc");
    }
  });

  it("rejects a session.meta missing conversationId", () => {
    const raw = {
      v: 1,
      id: "evt-bad",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "session.meta",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });
});
