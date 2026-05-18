"use client";

import { createElement, Fragment, type ReactNode } from "react";
import { useToolCalls } from "./selectors.js";
import type { ToolCall } from "./reducer.js";

/** Props for {@link ToolCallStream}. */
export interface ToolCallStreamProps {
  /** Called for each tool call in insertion order; return JSX or null. */
  render: (call: ToolCall) => ReactNode;
}

/**
 * Headless renderer that maps `state.toolCallsOrder` through `render`.
 * The library does not impose visual styling — the pill / spinner / result
 * UI is the host's seam.
 */
export function ToolCallStream({ render }: ToolCallStreamProps) {
  const calls = useToolCalls();
  return (
    <>
      {calls.map((call) =>
        createElement(Fragment, { key: call.id }, render(call)),
      )}
    </>
  );
}
