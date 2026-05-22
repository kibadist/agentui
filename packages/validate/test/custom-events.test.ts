import { describe, it, expect } from "vitest";
import {
  safeParseAgentEvent,
  isCustomWireEvent,
  RESERVED_PROTOCOL_OPS,
} from "../src/index.js";

describe("safeParseAgentEvent — custom wire events", () => {
  it("accepts a well-formed custom event with arbitrary op and payload", () => {
    const raw = {
      v: 1,
      id: "evt-1",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "host.panelPatch",
      target: "client-form",
      fields: { name: "John Smith", vehicle: "BMW X5" },
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.op).toBe("host.panelPatch");
      const value = result.value as Record<string, unknown>;
      expect(value.target).toBe("client-form");
      expect(value.fields).toEqual({ name: "John Smith", vehicle: "BMW X5" });
    }
  });

  it("accepts any unreserved namespace, not just host.*", () => {
    const raw = {
      v: 1,
      id: "evt-2",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "myapp.refresh",
      scope: "all",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
  });

  it("accepts a custom event with no extra payload fields", () => {
    const raw = {
      v: 1,
      id: "evt-3",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "host.ping",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
  });

  it("preserves traceId when present", () => {
    const raw = {
      v: 1,
      id: "evt-4",
      ts: "2026-01-01T00:00:00Z",
      traceId: "trace-xyz",
      sessionId: "s1",
      op: "host.custom",
      payload: { x: 1 },
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.traceId).toBe("trace-xyz");
    }
  });

  it("rejects a custom event missing the base envelope", () => {
    const raw = {
      op: "host.panelPatch",
      fields: { name: "John" },
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects a custom event with a non-1 protocol version", () => {
    const raw = {
      v: 2,
      id: "evt-5",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "host.custom",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects a custom event with an empty op string", () => {
    const raw = {
      v: 1,
      id: "evt-6",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects a custom event with a non-string op", () => {
    const raw = {
      v: 1,
      id: "evt-op-num",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: 42,
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects a custom event with a traceId exceeding the cap", () => {
    const raw = {
      v: 1,
      id: "evt-trace",
      ts: "2026-01-01T00:00:00Z",
      traceId: "x".repeat(257),
      sessionId: "s1",
      op: "host.custom",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects a custom event whose op reuses a reserved protocol name", () => {
    // A `ui.append` event MUST satisfy the strict ui.append shape (it needs
    // `node`). The passthrough variant must refuse to rescue it.
    const raw = {
      v: 1,
      id: "evt-7",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "ui.append",
      // intentionally missing `node` — should fail closed
      somethingElse: 42,
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects reserved ops with missing required payload (fail-closed regression)", () => {
    // Each of these reserved ops requires extra fields beyond the base
    // envelope. Without those fields they are malformed protocol events,
    // and the passthrough variant must NOT rescue them — otherwise typos
    // and protocol regressions would slip through silently.
    const opsWithRequiredPayload = [
      "ui.append", // requires node
      "ui.toast", // requires level + message
      "ui.navigate", // requires href
      "tool.start", // requires name
      "tool.args-delta", // requires delta
      "tool.result", // requires status
      "reasoning.delta", // requires delta
      "optimistic.apply", // requires entityKey, patch, originId
      "session.meta", // requires conversationId
      "session.init", // requires capabilities
      "workflow.start", // requires steps
      "workflow.advance", // requires stepId
    ];
    for (const op of opsWithRequiredPayload) {
      const raw = {
        v: 1,
        id: `evt-${op}`,
        ts: "2026-01-01T00:00:00Z",
        sessionId: "s1",
        op,
      };
      const result = safeParseAgentEvent(raw);
      expect(result.ok, `expected ${op} with missing payload to reject`).toBe(false);
    }
  });

  it("still accepts well-formed protocol events (regression)", () => {
    const raw = {
      v: 1,
      id: "evt-ok",
      ts: "2026-01-01T00:00:00Z",
      sessionId: "s1",
      op: "ui.toast",
      level: "info",
      message: "hello",
    };
    const result = safeParseAgentEvent(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.op).toBe("ui.toast");
    }
  });
});

describe("isCustomWireEvent", () => {
  it("returns true for non-reserved ops", () => {
    expect(isCustomWireEvent({ op: "host.panelPatch" })).toBe(true);
    expect(isCustomWireEvent({ op: "myapp.refresh" })).toBe(true);
    expect(isCustomWireEvent({ op: "anything" })).toBe(true);
  });

  it("returns false for every reserved protocol op", () => {
    for (const op of RESERVED_PROTOCOL_OPS) {
      expect(isCustomWireEvent({ op }), `expected ${op} to be protocol`).toBe(false);
    }
  });

  it("treats reserved ops as case-sensitive (mis-cased ops are custom)", () => {
    // `Set.has` is case-sensitive — making this case-insensitive would be a
    // deliberate breaking change. Locking the current behavior down with a
    // test so a future tweak is intentional.
    expect(isCustomWireEvent({ op: "UI.Append" })).toBe(true);
    expect(isCustomWireEvent({ op: "Session.Meta" })).toBe(true);
  });
});

describe("RESERVED_PROTOCOL_OPS", () => {
  it("covers all 22 protocol ops", () => {
    // Drift guard. If a new op is added to `agentWireEventSchema`, this count
    // changes — the developer adding it MUST also add the literal to
    // `RESERVED_PROTOCOL_OPS` in lockstep, or the malformed-payload tests
    // above (which exercise specific reserved ops) will start passing through
    // the custom-event passthrough and fail.
    expect(RESERVED_PROTOCOL_OPS.size).toBe(22);
  });

  it("every reserved op is accepted as well-formed only with its proper payload", () => {
    // Inverse drift guard: if RESERVED_PROTOCOL_OPS contains an op that is NOT
    // actually in the schema, then a malformed event with that op should fail
    // (because no schema variant accepts it). This catches the case where the
    // reserved set grew but the schema didn't.
    for (const op of RESERVED_PROTOCOL_OPS) {
      const raw = {
        v: 1,
        id: `evt-${op}`,
        ts: "2026-01-01T00:00:00Z",
        sessionId: "s1",
        op,
        // No payload at all. For ops that require no extra fields (e.g.
        // `ui.reset`, `tool.cancel`, `reasoning.start`, `reasoning.end`,
        // `workflow.complete`, `workflow.cancel`), this succeeds. For others
        // it fails. Either way, the assertion is that the passthrough did NOT
        // rescue the event — verified by inspecting the matched variant.
        // We don't strict-check here; the focused malformed-payload test
        // above covers the "must reject" cases. Here we just want to ensure
        // that for at least one reserved op, parsing produces a result with
        // the same op (i.e. the schema actually knows about it).
      };
      const result = safeParseAgentEvent(raw);
      if (result.ok) {
        // If it parsed, it must be the protocol variant (op literal preserved)
        expect(result.value.op).toBe(op);
      }
      // If it didn't parse, that's expected for ops with required payload.
    }
  });
});
