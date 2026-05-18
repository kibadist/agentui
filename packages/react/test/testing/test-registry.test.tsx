import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AgentRenderer, createInitialAgentState, type AgentState } from "../../src/index.js";
import { createTestRegistry } from "../../src/testing/test-registry.js";
import type { UINode } from "@kibadist/agentui-protocol";

afterEach(cleanup);

function makeState(nodes: UINode[]): AgentState {
  const byKey = new Map<string, number>();
  nodes.forEach((n, i) => byKey.set(n.key, i));
  return { ...createInitialAgentState(), nodes, byKey };
}

function Known({ label }: { label: string }) {
  return <span data-testid={`known-${label}`}>{label}</span>;
}

describe("createTestRegistry", () => {
  it("resolves known types to the supplied component", () => {
    const registry = createTestRegistry({ "known.kind": { component: Known } });
    const state = makeState([{ key: "k1", type: "known.kind", props: { label: "alpha" } }]);
    const { getByTestId } = render(<AgentRenderer state={state} registry={registry} />);
    expect(getByTestId("known-alpha")).toBeTruthy();
  });

  it("renders a marker for unregistered types with serialized props", () => {
    const registry = createTestRegistry({});
    const state = makeState([{ key: "k1", type: "mystery", props: { hello: "world" } }]);
    const { getByTestId } = render(<AgentRenderer state={state} registry={registry} />);
    const marker = getByTestId("test-marker-mystery");
    expect(marker.textContent).toContain("hello");
    expect(marker.textContent).toContain("world");
  });

  it("returns the same component reference for repeated lookups of an unknown type", () => {
    const registry = createTestRegistry({});
    const a = registry.get("repeat.type");
    const b = registry.get("repeat.type");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a!.component).toBe(b!.component);
  });
});
