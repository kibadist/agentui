import { describe, it, expect } from "vitest";
import { safeParseUIEvent } from "../src/index.js";

describe("safeParseUIEvent — ui.reset", () => {
  it("round-trips a valid ui.reset event with narrowing", () => {
    const raw = {
      v: 1,
      id: "evt-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "ui.reset",
    };
    const result = safeParseUIEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Discriminant narrowing: TS should see UIResetEvent here.
      expect(result.value.op).toBe("ui.reset");
      expect(result.value.sessionId).toBe("s1");
    }
  });

  it("rejects __reset__ as a wire event (internal action only)", () => {
    // The synthetic local action used by useAgentStream().reset() must NOT
    // be accepted from the wire. This guards against accidental export
    // through SSE/proxy paths.
    const raw = {
      v: 1,
      id: "evt-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "__reset__",
    };
    const result = safeParseUIEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects ui.reset with missing baseEvent fields", () => {
    const raw = { op: "ui.reset" };
    const result = safeParseUIEvent(raw);
    expect(result.ok).toBe(false);
  });
});
