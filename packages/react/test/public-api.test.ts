import { describe, it, expect } from "vitest";
import type {
  UIEvent,
  UIAppendEvent,
  UIReplaceEvent,
  UIRemoveEvent,
  UIToastEvent,
  UINavigateEvent,
  UIResetEvent,
  UINode,
} from "../src/index.js";

// Compile-time assertion: every protocol event type must be re-exported.
// If any of these imports goes missing, the file fails to typecheck.
type _AssertTypesExist =
  | UIEvent
  | UIAppendEvent
  | UIReplaceEvent
  | UIRemoveEvent
  | UIToastEvent
  | UINavigateEvent
  | UIResetEvent
  | UINode;

// onEvent narrowing — exhaustive switch with `never` fallback. If a new op
// is added to UIEvent and forgotten here, this fails to compile.
function _exhaustiveNarrowing(event: UIEvent): string {
  switch (event.op) {
    case "ui.append":
      return event.node.key;
    case "ui.replace":
      return event.key;
    case "ui.remove":
      return event.key;
    case "ui.toast":
      return event.message;
    case "ui.navigate":
      return event.href;
    case "ui.reset":
      return event.id;
    default: {
      const _: never = event;
      return _;
    }
  }
}

describe("public API", () => {
  it("re-exports all wire-protocol event types (typecheck-only)", () => {
    // The real assertion is at compile time — the imports + narrowing above.
    // This runtime check just registers the case with vitest.
    expect(typeof _exhaustiveNarrowing).toBe("function");
  });
});
