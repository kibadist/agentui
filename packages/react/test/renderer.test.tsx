import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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
