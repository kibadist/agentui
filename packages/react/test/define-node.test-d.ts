import { expectTypeOf, test } from "vitest";
import { z } from "zod";
import type { ComponentType } from "react";
import { defineNode } from "../src/define-node.js";

const Comp: ComponentType<{ text: string; count: number }> = () => null;

test("schema drives component props inference", () => {
  const schema = z.object({ text: z.string(), count: z.number() });
  const node = defineNode({ type: "x", schema, component: Comp });
  expectTypeOf(node.schema).toEqualTypeOf<typeof schema>();
  expectTypeOf<Parameters<typeof node.build>[0]["props"]>().toEqualTypeOf<{
    text: string;
    count: number;
  }>();
});

test("build rejects mismatched props", () => {
  const schema = z.object({ text: z.string() });
  const node = defineNode({
    type: "x",
    schema,
    component: (_props: { text: string }) => null,
  });
  // @ts-expect-error — props.text must be string, not number
  node.build({ key: "k1", props: { text: 5 } });
  // @ts-expect-error — props.text is required
  node.build({ key: "k1", props: {} });
  // @ts-expect-error — unknown prop "extra"
  node.build({ key: "k1", props: { text: "ok", extra: 1 } });
});

test("build forbids meta.requires (forced via defineNode)", () => {
  const node = defineNode({
    type: "x",
    schema: z.object({ text: z.string() }),
    component: (_props: { text: string }) => null,
    requires: ["x.read"],
  });
  // @ts-expect-error — meta.requires is auto-derived from defineNode; can't be passed here
  node.build({ key: "k1", props: { text: "ok" }, meta: { requires: ["other"] } });
  // ttlMs is allowed
  node.build({ key: "k1", props: { text: "ok" }, meta: { ttlMs: 100 } });
});

test("component prop type must match schema", () => {
  defineNode({
    type: "x",
    schema: z.object({ text: z.string() }),
    // @ts-expect-error — component expects { wrong: boolean } but schema is { text: string }
    component: (() => null) as ComponentType<{ wrong: boolean }>,
  });
});
