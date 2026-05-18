import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { UINode } from "@kibadist/agentui-protocol";
import { AgentRenderer, createRegistry } from "../src/index.js";
import type { AgentState } from "../src/index.js";

// vitest is configured with `globals: false`, so RTL's auto-cleanup
// doesn't wire itself up automatically. Do it explicitly.
afterEach(cleanup);

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

describe("AgentRenderer — filter", () => {
  it("calls filter with (node, index) where index is post-slot pre-range", () => {
    const state = makeState(
      Array.from({ length: 5 }, (_, i) => makeNode(`k${i}`, "test.box", { label: `${i}` })),
    );
    const calls: Array<{ key: string; index: number }> = [];
    const filter = (node: UINode, index: number) => {
      calls.push({ key: node.key, index });
      return true;
    };
    render(
      <AgentRenderer
        state={state}
        registry={registry}
        range={{ start: 1, end: 4 }}
        filter={filter}
      />,
    );
    // Indices passed must be the original positions in state.nodes, not 0..n-1
    expect(calls).toEqual([
      { key: "k1", index: 1 },
      { key: "k2", index: 2 },
      { key: "k3", index: 3 },
    ]);
  });

  it("skips nodes where filter returns false", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
      makeNode("c", "test.box", { label: "c" }),
    ]);
    const { queryAllByTestId } = render(
      <AgentRenderer
        state={state}
        registry={registry}
        filter={(n) => n.key !== "b"}
      />,
    );
    const ids = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual(["box-a", "box-c"]);
  });

  it("rendered set is stable across rerenders when filter is referentially equal", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
      makeNode("c", "test.box", { label: "c" }),
    ]);
    const stableFilter = (n: UINode) => n.key !== "b";

    const { rerender, queryAllByTestId } = render(
      <AgentRenderer state={state} registry={registry} filter={stableFilter} />,
    );
    const first = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));

    rerender(
      <AgentRenderer state={state} registry={registry} filter={stableFilter} />,
    );
    const second = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));

    expect(second).toEqual(first);
    expect(second).toEqual(["box-a", "box-c"]);
  });
});

describe("AgentRenderer — hiddenTypes", () => {
  it("excludes nodes whose type is in the set", () => {
    const localRegistry = createRegistry({
      "test.box": { component: Box },
      "panel-patch": { component: () => <span data-testid="patch">patch</span> },
    });
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("p", "panel-patch"),
      makeNode("c", "test.box", { label: "c" }),
    ]);
    const { queryAllByTestId } = render(
      <AgentRenderer
        state={state}
        registry={localRegistry}
        hiddenTypes={["panel-patch"]}
      />,
    );
    const boxes = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(boxes).toEqual(["box-a", "box-c"]);
    expect(queryAllByTestId("patch")).toHaveLength(0);
  });

  it("hiddenTypes is applied AFTER filter (hard exclusion)", () => {
    const localRegistry = createRegistry({
      "test.box": { component: Box },
      "panel-patch": { component: () => <span data-testid="patch">patch</span> },
    });
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("p", "panel-patch"),
    ]);
    // Filter tries to re-admit panel-patch; hiddenTypes still excludes it.
    const { queryAllByTestId } = render(
      <AgentRenderer
        state={state}
        registry={localRegistry}
        filter={() => true}
        hiddenTypes={["panel-patch"]}
      />,
    );
    expect(queryAllByTestId("patch")).toHaveLength(0);
  });
});

describe("AgentRenderer — errorFallback", () => {
  it("renders the fallback when a component throws; siblings unaffected", () => {
    // Silence the React error log that fires when an EB catches.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Throwing({ label }: { label: string }) {
      throw new Error(`boom-${label}`);
    }
    const localRegistry = createRegistry({
      "test.box": { component: Box },
      "test.throwing": { component: Throwing },
    });

    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("bad", "test.throwing", { label: "x" }),
      makeNode("c", "test.box", { label: "c" }),
    ]);

    const { queryAllByTestId, queryByTestId } = render(
      <AgentRenderer
        state={state}
        registry={localRegistry}
        errorFallback={(err, node) => (
          <span data-testid={`err-${node.key}`}>{err.message}</span>
        )}
      />,
    );

    const boxes = queryAllByTestId(/^box-/).map((el) => el.getAttribute("data-testid"));
    expect(boxes).toEqual(["box-a", "box-c"]);
    expect(queryByTestId("err-bad")?.textContent).toBe("boom-x");

    errSpy.mockRestore();
  });

  it("without errorFallback, errors propagate (no boundary attached)", () => {
    // Control case for the opt-in contract: when errorFallback is undefined,
    // there must be NO internal boundary — the throw must reach the caller.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Throwing() {
      throw new Error("uncaught");
    }
    const localRegistry = createRegistry({
      "test.throwing": { component: Throwing },
    });
    const state = makeState([makeNode("bad", "test.throwing")]);

    expect(() =>
      render(<AgentRenderer state={state} registry={localRegistry} />),
    ).toThrow("uncaught");

    errSpy.mockRestore();
  });
});

describe("AgentRenderer — nodeWrapper", () => {
  it("wraps every rendered node with the supplied wrapper", () => {
    const state = makeState([
      makeNode("a", "test.box", { label: "a" }),
      makeNode("b", "test.box", { label: "b" }),
    ]);
    const calls: Array<string> = [];
    const { container, queryAllByTestId } = render(
      <AgentRenderer
        state={state}
        registry={registry}
        nodeWrapper={(node, children) => {
          calls.push(node.key);
          return <div data-wrap={node.key}>{children}</div>;
        }}
      />,
    );
    expect(calls).toEqual(["a", "b"]);
    expect(container.querySelector('[data-wrap="a"] [data-testid="box-a"]')).not.toBeNull();
    expect(container.querySelector('[data-wrap="b"] [data-testid="box-b"]')).not.toBeNull();
    expect(queryAllByTestId(/^box-/)).toHaveLength(2);
  });

  it("composition: nodeWrapper sits OUTSIDE the error boundary", () => {
    // When the inner component throws, the wrapper element should still be
    // in the DOM (so framer-motion / AnimatePresence keys stay tracked) and
    // the fallback content should sit inside that wrapper.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Throwing() {
      throw new Error("inner-boom");
    }
    const localRegistry = createRegistry({
      "test.throwing": { component: Throwing },
    });

    const state = makeState([makeNode("bad", "test.throwing")]);

    const { container } = render(
      <AgentRenderer
        state={state}
        registry={localRegistry}
        errorFallback={(err) => <span data-testid="fallback">{err.message}</span>}
        nodeWrapper={(node, children) => <div data-wrap={node.key}>{children}</div>}
      />,
    );

    const wrap = container.querySelector('[data-wrap="bad"]');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('[data-testid="fallback"]')?.textContent).toBe("inner-boom");

    errSpy.mockRestore();
  });
});
