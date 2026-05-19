import { describe, it, expect } from "vitest";
import { safeParseUIEvent } from "../src/index.js";
import { agentWireEventSchema } from "../src/schemas.js";

const base = {
  v: 1 as const,
  id: "e1",
  ts: "2026-05-19T00:00:00.000Z",
  sessionId: "s1",
};

describe("workflow.* validation", () => {
  it("accepts a valid workflow.start", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [
        { id: "s1", title: "First" },
        { id: "s2", title: "Second", nodeKey: "node-a" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects workflow.start with empty steps", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects workflow.start with duplicate step ids", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [
        { id: "s1", title: "First" },
        { id: "s1", title: "Dup" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts workflow.advance", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.advance",
      id: "wf1",
      stepId: "s2",
    });
    expect(r.success).toBe(true);
  });

  it("rejects workflow.advance missing stepId", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.advance",
      id: "wf1",
    });
    expect(r.success).toBe(false);
  });

  it("accepts workflow.complete with arbitrary result", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.complete",
      id: "wf1",
      result: { ok: true, count: 5 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts workflow.cancel with reason", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.cancel",
      id: "wf1",
      reason: "user aborted",
    });
    expect(r.success).toBe(true);
  });

  it("rejects workflow.cancel with reason longer than 1024 chars", () => {
    const r = agentWireEventSchema.safeParse({
      ...base,
      op: "workflow.cancel",
      id: "wf1",
      reason: "x".repeat(1025),
    });
    expect(r.success).toBe(false);
  });

  it("safeParseUIEvent rejects workflow events (not UI events)", () => {
    const r = safeParseUIEvent({
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [{ id: "s1", title: "First" }],
    });
    expect(r.ok).toBe(false);
  });
});
