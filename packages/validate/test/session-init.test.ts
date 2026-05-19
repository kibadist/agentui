import { describe, it, expect } from "vitest";
import { agentWireEventSchema } from "../src/schemas.js";

const base = {
  v: 1 as const,
  id: "e1",
  ts: "2026-05-19T00:00:00Z",
  sessionId: "s1",
};

describe("session.init schema", () => {
  it("accepts a valid event", () => {
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
      capabilities: {
        nodeTypes: ["Card", "Quote"],
        actions: ["purchase.confirm"],
        permissions: ["quotes.write", "clients.read"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays", () => {
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
      capabilities: { nodeTypes: [], actions: [], permissions: [] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing capabilities", () => {
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string array entries", () => {
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
      capabilities: { nodeTypes: [1], actions: [], permissions: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects arrays with more than 512 entries", () => {
    const many = Array.from({ length: 513 }, (_, i) => `p${i}`);
    const result = agentWireEventSchema.safeParse({
      ...base,
      op: "session.init",
      capabilities: { nodeTypes: [], actions: [], permissions: many },
    });
    expect(result.success).toBe(false);
  });
});
