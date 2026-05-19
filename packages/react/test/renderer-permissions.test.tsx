import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { AgentRenderer } from "../src/renderer.js";
import { createRegistry } from "../src/registry.js";
import { createInitialAgentState } from "../src/reducer.js";
import type { AgentState } from "../src/reducer.js";

const Card = ({ label }: { label: string }) => <div data-testid="card">{label}</div>;

function makeState(opts: { declared: boolean; perms: string[]; nodeLabel?: string }): AgentState {
  const s = createInitialAgentState();
  s.capabilities = {
    declared: opts.declared,
    nodeTypes: new Set(["Card"]),
    actions: new Set(),
    permissions: new Set(opts.perms),
  };
  s.nodes.push({
    key: "n1",
    type: "Card",
    props: { label: opts.nodeLabel ?? "hello" },
  });
  s.byKey.set("n1", 0);
  return s;
}

describe("AgentRenderer — permission gating", () => {
  const registry = createRegistry({
    Card: { component: Card, requires: ["quotes.write"] },
  });

  it("renders the node when declared=false (back-compat)", () => {
    const state = makeState({ declared: false, perms: [] });
    const { getByTestId } = render(<AgentRenderer state={state} registry={registry} />);
    expect(getByTestId("card").textContent).toBe("hello");
  });

  it("renders the node when declared=true and permissions match", () => {
    const state = makeState({ declared: true, perms: ["quotes.write"] });
    const { getByTestId } = render(<AgentRenderer state={state} registry={registry} />);
    expect(getByTestId("card").textContent).toBe("hello");
  });

  it("hides the node silently when declared=true and permissions are missing", () => {
    const state = makeState({ declared: true, perms: [] });
    const { container } = render(<AgentRenderer state={state} registry={registry} />);
    expect(container.querySelector("[data-testid='card']")).toBeNull();
  });

  it("calls permissionFallback with the missing permissions list", () => {
    const state = makeState({ declared: true, perms: [] });
    const { getByTestId } = render(
      <AgentRenderer
        state={state}
        registry={registry}
        permissionFallback={(node, missing) => (
          <div data-testid="blocked">
            {node.key}/{missing.join(",")}
          </div>
        )}
      />,
    );
    expect(getByTestId("blocked").textContent).toBe("n1/quotes.write");
  });

  it("computes missing as the diff, not the full required list", () => {
    const multiRegistry = createRegistry({
      Card: { component: Card, requires: ["quotes.write", "clients.read"] },
    });
    const state = makeState({ declared: true, perms: ["clients.read"] });
    const { getByTestId } = render(
      <AgentRenderer
        state={state}
        registry={multiRegistry}
        permissionFallback={(_node, missing) => (
          <div data-testid="blocked">{missing.join(",")}</div>
        )}
      />,
    );
    expect(getByTestId("blocked").textContent).toBe("quotes.write");
  });

  it("ignores nodes whose spec.requires is undefined", () => {
    const noReqRegistry = createRegistry({ Card: { component: Card } });
    const state = makeState({ declared: true, perms: [] });
    const { getByTestId } = render(<AgentRenderer state={state} registry={noReqRegistry} />);
    expect(getByTestId("card").textContent).toBe("hello");
  });
});
