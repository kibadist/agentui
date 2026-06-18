import { describe, it, expect, beforeAll } from "vitest";
import { MemoryMap } from "../src/components/memory-map.js";
import type { MemoryData } from "../src/types.js";
import type { SelectDetail, EditDetail, RemoveDetail } from "../src/base/events.js";

beforeAll(() => {
  if (!customElements.get("agentui-memory-map")) {
    customElements.define("agentui-memory-map", MemoryMap);
  }
});

const DATA: MemoryData = {
  nodes: [
    { id: "src", label: "Docs source", type: "source", group: "a" },
    { id: "pref", label: "Dark mode preference", type: "preference", group: "a" },
    { id: "rule", label: "No secrets in logs", type: "rule", group: "b" },
    { id: "proj", label: "AgentUI repo", type: "project", group: "b" },
    { id: "out", label: "Final answer", type: "output", group: "b" },
  ],
  links: [
    { id: "l1", from: "src", to: "proj", strength: 0.2 },
    { id: "l2", from: "pref", to: "out", strength: 0.95 },
    { id: "l3", from: "rule", to: "out", strength: 0.6 },
  ],
};

function mount(data: MemoryData, layout?: string): MemoryMap {
  const el = document.createElement("agentui-memory-map") as MemoryMap;
  if (layout) el.setAttribute("layout", layout);
  document.body.append(el);
  el.data = data;
  el.renderNow();
  return el;
}

function nodeX(el: MemoryMap, id: string): number {
  const g = el.shadowRoot!.querySelector(`[data-node-id="${id}"]`)!;
  return Number(g.getAttribute("transform")!.match(/translate\(([\d.-]+)/)![1]);
}

describe("agentui-memory-map", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("agentui-memory-map")).toBe(MemoryMap);
  });

  it("renders one node per data node", () => {
    const el = mount(DATA);
    expect(el.shadowRoot!.querySelectorAll("[data-node-id]").length).toBe(5);
  });

  it("styles nodes by type", () => {
    const el = mount(DATA);
    const src = el.shadowRoot!.querySelector('[data-node-id="src"]')!;
    expect(src.classList.contains("type-source")).toBe(true);
    expect(src.getAttribute("data-type")).toBe("source");
    const out = el.shadowRoot!.querySelector('[data-node-id="out"]')!;
    expect(out.getAttribute("data-type")).toBe("output");
  });

  it("renders links with strength driving stroke-width (thicker for stronger)", () => {
    const el = mount(DATA);
    const weak = el.shadowRoot!.querySelector('[data-link-id="l1"] .mm-link')!;
    const strong = el.shadowRoot!.querySelector('[data-link-id="l2"] .mm-link')!;
    const weakW = Number(weak.getAttribute("stroke-width"));
    const strongW = Number(strong.getAttribute("stroke-width"));
    expect(strongW).toBeGreaterThan(weakW);
    // Stronger links are also more opaque.
    expect(Number(strong.getAttribute("stroke-opacity"))).toBeGreaterThan(
      Number(weak.getAttribute("stroke-opacity")),
    );
  });

  it("emits agentui:select with node detail on activation", () => {
    const el = mount(DATA);
    let detail: SelectDetail | null = null;
    el.addEventListener("agentui:select", (e) => {
      detail = (e as CustomEvent<SelectDetail>).detail;
    });
    const node = el.shadowRoot!.querySelector('[data-node-id="pref"]')!;
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("pref");
    expect(detail!.kind).toBe("node");
    expect((detail!.data as { label: string }).label).toBe("Dark mode preference");
  });

  it("emits agentui:select with link kind on link activation", () => {
    const el = mount(DATA);
    let detail: SelectDetail | null = null;
    el.addEventListener("agentui:select", (e) => {
      detail = (e as CustomEvent<SelectDetail>).detail;
    });
    const hit = el.shadowRoot!.querySelector('[data-link-id="l1"] [data-activate]')!;
    hit.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("l1");
    expect(detail!.kind).toBe("link");
  });

  it("activates a node via keyboard (Enter)", () => {
    const el = mount(DATA);
    let count = 0;
    el.addEventListener("agentui:select", () => count++);
    const node = el.shadowRoot!.querySelector('[data-node-id="rule"]')!;
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(count).toBe(1);
  });

  it("marks the selected node aria-selected", () => {
    const el = mount(DATA);
    el.selectById("proj");
    const node = el.shadowRoot!.querySelector('[data-node-id="proj"]')!;
    expect(node.getAttribute("aria-selected")).toBe("true");
  });

  it("emits agentui:edit with id from the edit affordance", () => {
    const el = mount(DATA);
    let detail: EditDetail | null = null;
    el.addEventListener("agentui:edit", (e) => {
      detail = (e as CustomEvent<EditDetail>).detail;
    });
    el.selectById("pref");
    const edit = el.shadowRoot!.querySelector('[data-node-id="pref"] [data-affordance="edit"]')!;
    edit.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("pref");
  });

  it("emits agentui:remove with id from the remove affordance", () => {
    const el = mount(DATA);
    let detail: RemoveDetail | null = null;
    el.addEventListener("agentui:remove", (e) => {
      detail = (e as CustomEvent<RemoveDetail>).detail;
    });
    el.selectById("pref");
    const remove = el.shadowRoot!.querySelector('[data-node-id="pref"] [data-affordance="remove"]')!;
    remove.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("pref");
  });

  it("grouped layout positions nodes differently than default", () => {
    const def = mount(DATA);
    const grp = mount(DATA, "grouped");
    // The default layout columns sources left / outputs right; grouped clusters
    // by group key, so at least one node moves.
    const moved = DATA.nodes.some((n) => nodeX(def, n.id) !== nodeX(grp, n.id));
    expect(moved).toBe(true);
  });

  it("shows an empty state when there are no nodes", () => {
    const el = mount({ nodes: [] });
    expect(el.shadowRoot!.querySelector(".agentui-state")?.textContent).toMatch(/no memory/i);
  });

  it("makes interactive parts keyboard reachable (tabindex/role/aria-label)", () => {
    const el = mount(DATA);
    const node = el.shadowRoot!.querySelector('[data-node-id="src"]')!;
    expect(node.getAttribute("tabindex")).toBe("0");
    expect(node.getAttribute("role")).toBe("button");
    expect(node.getAttribute("aria-label")).toBeTruthy();
    const link = el.shadowRoot!.querySelector('[data-link-id="l1"] [data-activate]')!;
    expect(link.getAttribute("tabindex")).toBe("0");
    expect(link.getAttribute("aria-label")).toBeTruthy();
  });
});
