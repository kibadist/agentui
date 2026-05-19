import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StateTree } from "../../src/devtools/state-tree.js";
import { agentReducer, createInitialAgentState } from "../../src/reducer.js";
import type { AgentAction } from "../../src/reducer.js";

const append = (key: string, type = "text-block"): AgentAction => ({
  op: "ui.append",
  id: `e-${key}`,
  ts: "2026-05-19T00:00:00Z",
  sessionId: "s",
  node: { key, type, props: {} },
});

describe("<StateTree />", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders top-level section counts", () => {
    const s0 = createInitialAgentState();
    const s1 = agentReducer(s0, append("k1"));
    const s2 = agentReducer(s1, append("k2"));
    render(<StateTree state={s2} />);
    expect(screen.getByText(/nodes \(2\)/i)).toBeTruthy();
    expect(screen.getByText(/toolCalls \(0\)/i)).toBeTruthy();
    expect(screen.getByText(/reasoning \(0\)/i)).toBeTruthy();
    expect(screen.getByText(/byKey \(2\)/i)).toBeTruthy();
  });

  it("expanding nodes shows individual entries", () => {
    const s0 = createInitialAgentState();
    const s1 = agentReducer(s0, append("hello"));
    render(<StateTree state={s1} />);
    // "hello" appears in both the nodes section (as the key) and the byKey
    // section (as the index entry). Both are expected.
    expect(screen.getAllByText(/hello/).length).toBeGreaterThan(0);
    expect(screen.getByText(/text-block/)).toBeTruthy();
  });
});
