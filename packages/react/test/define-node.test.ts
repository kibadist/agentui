import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineNode } from "../src/define-node.js";
import type { ComponentType } from "react";

const NoopComponent: ComponentType<{ text: string }> = () => null;

describe("defineNode", () => {
  it("returns an object with type, schema, component, requires, build", () => {
    const node = defineNode({
      type: "quote",
      schema: z.object({ text: z.string() }),
      component: NoopComponent,
    });
    expect(node.type).toBe("quote");
    expect(node.component).toBe(NoopComponent);
    expect(typeof node.build).toBe("function");
    expect(node.requires).toBeUndefined();
  });

  it("exposes the requires array from options", () => {
    const node = defineNode({
      type: "quote",
      schema: z.object({ text: z.string() }),
      component: NoopComponent,
      requires: ["quotes.read"],
    });
    expect(node.requires).toEqual(["quotes.read"]);
  });

  describe(".build()", () => {
    const node = defineNode({
      type: "quote",
      schema: z.object({ text: z.string(), count: z.number().optional() }),
      component: NoopComponent,
    });

    it("returns a UINode with validated props", () => {
      const out = node.build({ key: "k1", props: { text: "hi" } });
      expect(out).toEqual({
        key: "k1",
        type: "quote",
        props: { text: "hi" },
      });
    });

    it("propagates slot", () => {
      const out = node.build({ key: "k1", props: { text: "hi" }, slot: "main" });
      expect(out.slot).toBe("main");
    });

    it("merges user meta with derived requires", () => {
      const guarded = defineNode({
        type: "quote",
        schema: z.object({ text: z.string() }),
        component: NoopComponent,
        requires: ["quotes.read"],
      });
      const out = guarded.build({
        key: "k1",
        props: { text: "hi" },
        meta: { ttlMs: 5000 },
      });
      expect(out.meta).toEqual({ ttlMs: 5000, requires: ["quotes.read"] });
    });

    it("omits meta.requires when defineNode has no requires", () => {
      const out = node.build({ key: "k1", props: { text: "hi" }, meta: { ttlMs: 1000 } });
      expect(out.meta).toEqual({ ttlMs: 1000 });
      expect(out.meta && "requires" in out.meta).toBe(false);
    });

    it("returns no meta when neither requires nor user meta provided", () => {
      const out = node.build({ key: "k1", props: { text: "hi" } });
      expect(out.meta).toBeUndefined();
    });

    it("throws with the Zod error path on invalid props", () => {
      // @ts-expect-error — testing runtime, types prevent this
      expect(() => node.build({ key: "k1", props: { text: 5 } })).toThrow(/invalid props/i);
      try {
        // @ts-expect-error
        node.build({ key: "k1", props: {} });
        throw new Error("should have thrown");
      } catch (err) {
        expect((err as Error).message).toMatch(/text/);
      }
    });
  });
});
