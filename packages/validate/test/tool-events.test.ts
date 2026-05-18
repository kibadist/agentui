import { describe, it, expect } from "vitest";
import { safeParseAgentEvent } from "../src/index.js";

describe("safeParseAgentEvent — tool events", () => {
  it("round-trips a valid tool.start event with narrowing", () => {
    const raw = {
      v: 1,
      id: "t1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.start",
      name: "search_clients",
      args: { q: "acme" },
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "tool.start") {
      expect(result.value.name).toBe("search_clients");
      expect(result.value.args).toEqual({ q: "acme" });
    }
  });

  it("round-trips a valid tool.args-delta event", () => {
    const raw = {
      v: 1,
      id: "evt-delta",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.args-delta",
      delta: '{"q":"hi"',
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "tool.args-delta") {
      expect(result.value.delta).toBe('{"q":"hi"');
    }
  });

  it("round-trips a valid tool.result event", () => {
    const raw = {
      v: 1,
      id: "evt-result",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.result",
      status: "ok",
      result: { items: [] },
      durationMs: 42,
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "tool.result") {
      expect(result.value.status).toBe("ok");
      expect(result.value.result).toEqual({ items: [] });
      expect(result.value.durationMs).toBe(42);
    }
  });

  it("round-trips a valid tool.cancel event", () => {
    const raw = {
      v: 1,
      id: "evt-cancel",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.cancel",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed tool.result (missing status)", () => {
    const raw = {
      v: 1,
      id: "evt-bad",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "tool.result",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("still parses a valid ui.append event (back-compat)", () => {
    const raw = {
      v: 1,
      id: "evt-ui",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "ui.append",
      node: { key: "a", type: "test.node", props: {} },
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.op === "ui.append") {
      expect(result.value.node.key).toBe("a");
    }
  });
});
