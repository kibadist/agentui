import { describe, it, expect, vi } from "vitest";
import { createMetricEmitter, hashSessionId, type Metric } from "../src/metrics.js";

describe("hashSessionId", () => {
  it("is deterministic and 8 hex chars", () => {
    const a = hashSessionId("abc");
    const b = hashSessionId("abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs across inputs", () => {
    expect(hashSessionId("a")).not.toBe(hashSessionId("b"));
  });
});

describe("createMetricEmitter", () => {
  it("no-op when onMetric is undefined", () => {
    const emit = createMetricEmitter(undefined, { env: "test" });
    expect(() => emit.timing("foo", 5)).not.toThrow();
    expect(() => emit.counter("bar")).not.toThrow();
  });

  it("calls onMetric with merged tags for timing", () => {
    const spy = vi.fn();
    const emit = createMetricEmitter(spy, { env: "test", region: "us" });
    emit.timing("agentui.event.parse_ms", 1.23, { eventOp: "ui.append" });
    expect(spy).toHaveBeenCalledOnce();
    const m: Metric = spy.mock.calls[0][0];
    expect(m.name).toBe("agentui.event.parse_ms");
    expect(m.value).toBe(1.23);
    expect(m.kind).toBe("timing");
    expect(m.tags).toEqual({ env: "test", region: "us", eventOp: "ui.append" });
  });

  it("calls onMetric with value=1 for counter", () => {
    const spy = vi.fn();
    const emit = createMetricEmitter(spy, {});
    emit.counter("agentui.event.parse_error_count");
    expect(spy.mock.calls[0][0]).toMatchObject({
      name: "agentui.event.parse_error_count",
      value: 1,
      kind: "counter",
    });
  });

  it("caller tags override host tags on conflict", () => {
    const spy = vi.fn();
    const emit = createMetricEmitter(spy, { sessionId: "host" });
    emit.timing("x", 0, { sessionId: "caller" });
    expect(spy.mock.calls[0][0].tags.sessionId).toBe("caller");
  });
});
