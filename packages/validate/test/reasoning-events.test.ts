import { describe, it, expect } from "vitest";
import { safeParseAgentEvent } from "../src/index.js";

describe("safeParseAgentEvent — reasoning events", () => {
  it("round-trips a valid reasoning.start with turnId", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "reasoning.start",
      turnId: "turn-42",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "reasoning.start") {
      expect(result.value.turnId).toBe("turn-42");
    }
  });

  it("round-trips a valid reasoning.start without turnId", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "reasoning.start",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "reasoning.start") {
      expect(result.value.turnId).toBeUndefined();
    }
  });

  it("round-trips a valid reasoning.delta", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "reasoning.delta",
      delta: "Thinking about ",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "reasoning.delta") {
      expect(result.value.delta).toBe("Thinking about ");
    }
  });

  it("round-trips a valid reasoning.end with tokens", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:01Z",
      sessionId: "s1",
      op: "reasoning.end",
      tokens: 128,
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "reasoning.end") {
      expect(result.value.tokens).toBe(128);
    }
  });

  it("rejects a reasoning.delta missing delta", () => {
    const raw = {
      v: 1,
      id: "r1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "reasoning.delta",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("cross-cut: tool.start with turnId parses correctly", () => {
    const raw = {
      v: 1,
      id: "t1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.start",
      name: "search",
      turnId: "turn-7",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "tool.start") {
      expect(result.value.turnId).toBe("turn-7");
      expect(result.value.name).toBe("search");
    }
  });
});
