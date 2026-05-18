import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);
import type { UINode } from "@kibadist/agentui-protocol";
import { AgentRenderer, createRegistry } from "../src/index.js";
import type { AgentState } from "../src/index.js";

function makeNode(
  key: string,
  type = "test.box",
  props: Record<string, unknown> = {},
): UINode {
  return { key, type, props };
}

function makeState(nodes: UINode[]): AgentState {
  const byKey = new Map<string, number>();
  nodes.forEach((n, i) => byKey.set(n.key, i));
  return { nodes, byKey, toasts: [], navigate: null };
}

function Box({ label }: { label: string }) {
  return <span data-testid={`box-${label}`}>{label}</span>;
}

const registry = createRegistry({
  "test.box": { component: Box },
});

describe("AgentRenderer — baseline (no new props)", () => {
  it("renders every node in state.nodes order", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
      makeNode("c", "test.box", { label: "c" }),
    ]);
    const { getAllByTestId } = render(
      <AgentRenderer state={state} registry={registry} />,
    );
    const ids = getAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual(["box-a", "box-b", "box-c"]);
  });
});

describe("AgentRenderer — range", () => {
  it("renders only indices in the half-open [start, end) window", () => {
    const state = makeState(
      Array.from({ length: 7 }, (_, i) => makeNode(`k${i}`, "test.box", { label: `${i}` })),
    );
    const { queryAllByTestId } = render(
      <AgentRenderer state={state} registry={registry} range={{ start: 2, end: 5 }} />,
    );
    const ids = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual(["box-2", "box-3", "box-4"]);
  });

  it("clamps out-of-bounds range to the array length", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
    ]);
    const { queryAllByTestId } = render(
      <AgentRenderer state={state} registry={registry} range={{ start: -3, end: 999 }} />,
    );
    expect(queryAllByTestId(/^box-/)).toHaveLength(2);
  });

  it("treats start >= end as empty", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
    ]);
    const { queryAllByTestId } = render(
      <AgentRenderer state={state} registry={registry} range={{ start: 1, end: 1 }} />,
    );
    expect(queryAllByTestId(/^box-/)).toHaveLength(0);
  });
});
