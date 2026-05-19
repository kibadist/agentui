import { describe, it, expect } from "vitest";
import { uiEventSchema } from "../src/schemas.js";

const base = {
  v: 1 as const,
  id: "e1",
  ts: "2026-05-19T00:00:00Z",
  sessionId: "s1",
  op: "ui.replace" as const,
  key: "node-1",
};

describe("uiReplaceSchema with JSON Patch", () => {
  it("accepts a props-only event", () => {
    const result = uiEventSchema.safeParse({ ...base, props: { a: 1 } });
    expect(result.success).toBe(true);
  });

  it("accepts a patch-only event", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "replace", path: "/a", value: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects events with both props and patch", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      props: { a: 1 },
      patch: [{ op: "replace", path: "/a", value: 2 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects events with neither props nor patch", () => {
    const result = uiEventSchema.safeParse(base);
    expect(result.success).toBe(false);
  });

  it("rejects patch combined with replace flag", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "replace", path: "/a", value: 2 }],
      replace: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty patch array", () => {
    const result = uiEventSchema.safeParse({ ...base, patch: [] });
    expect(result.success).toBe(false);
  });

  it("rejects patch with more than 256 ops", () => {
    const ops = Array.from({ length: 257 }, (_, i) => ({
      op: "replace" as const,
      path: `/items/${i}`,
      value: i,
    }));
    const result = uiEventSchema.safeParse({ ...base, patch: ops });
    expect(result.success).toBe(false);
  });

  it("rejects invalid op kind", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "splat" as unknown as "add", path: "/a", value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid pointer (no leading slash, not empty)", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "replace", path: "a/b", value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty pointer (document root)", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [{ op: "replace", path: "", value: { a: 1 } }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts move/copy with from and path", () => {
    const result = uiEventSchema.safeParse({
      ...base,
      patch: [
        { op: "move", from: "/a", path: "/b" },
        { op: "copy", from: "/b", path: "/c" },
      ],
    });
    expect(result.success).toBe(true);
  });
});
