import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { ComponentType } from "react";
import { createRegistry } from "../src/registry.js";
import { defineNode } from "../src/define-node.js";

const Comp: ComponentType<{ text: string }> = () => null;

describe("createRegistry — array overload", () => {
  it("registers NodeDefinitions by their type", () => {
    const A = defineNode({ type: "a", schema: z.object({ text: z.string() }), component: Comp });
    const B = defineNode({ type: "b", schema: z.object({ text: z.string() }), component: Comp });
    const r = createRegistry([A, B]);
    expect(r.has("a")).toBe(true);
    expect(r.has("b")).toBe(true);
    expect(r.types().sort()).toEqual(["a", "b"]);
  });

  it("maps NodeDefinition fields into ComponentSpec shape", () => {
    const Node = defineNode({
      type: "a",
      schema: z.object({ text: z.string() }),
      component: Comp,
      requires: ["x.read"],
    });
    const r = createRegistry([Node]);
    const spec = r.get("a");
    expect(spec).toBeDefined();
    expect(spec?.component).toBe(Comp);
    expect(spec?.propsSchema).toBe(Node.schema);
    expect(spec?.requires).toEqual(["x.read"]);
  });

  it("empty array produces an empty registry", () => {
    const r = createRegistry([]);
    expect(r.types()).toEqual([]);
    expect(r.has("anything")).toBe(false);
  });

  it("throws on duplicate type keys in the array", () => {
    const A1 = defineNode({ type: "dup", schema: z.object({ text: z.string() }), component: Comp });
    const A2 = defineNode({ type: "dup", schema: z.object({ text: z.string() }), component: Comp });
    expect(() => createRegistry([A1, A2])).toThrow(/duplicate/i);
  });

  it("object form and array form produce equivalent registries", () => {
    const Node = defineNode({ type: "a", schema: z.object({ text: z.string() }), component: Comp });
    const fromArr = createRegistry([Node]);
    const fromObj = createRegistry({ a: { component: Comp, propsSchema: Node.schema } });
    expect(fromArr.types()).toEqual(fromObj.types());
    expect(fromArr.get("a")?.component).toBe(fromObj.get("a")?.component);
    expect(fromArr.get("a")?.propsSchema).toBe(fromObj.get("a")?.propsSchema);
  });
});
