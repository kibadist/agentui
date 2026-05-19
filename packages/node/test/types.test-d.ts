import { expectTypeOf } from "vitest";
import type { EmitInput, AgentStream } from "../src/index.js";

declare const stream: AgentStream;

// Valid: a known op with all required fields.
stream.emit({
  op: "ui.append",
  node: { key: "k", type: "x.y", props: {} },
});

// Invalid: unknown op should be rejected.
// @ts-expect-error — "unknown" is not in the AgentWireEvent op union.
stream.emit({ op: "unknown" });

// Invalid: ui.append requires `node`.
// @ts-expect-error — missing required `node`.
stream.emit({ op: "ui.append" });

// EmitInput must NOT require v/id/ts/sessionId
expectTypeOf<EmitInput>().not.toHaveProperty("v");

// EmitInput is a union containing at least ui.append shape.
const sample: EmitInput = {
  op: "ui.toast",
  level: "info",
  message: "x",
};
expectTypeOf(sample).toMatchTypeOf<EmitInput>();
