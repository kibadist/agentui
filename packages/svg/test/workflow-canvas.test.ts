import { describe, it, expect, beforeAll } from "vitest";
import { WorkflowCanvas } from "../src/components/workflow-canvas.js";
import type { WorkflowData } from "../src/types.js";
import type { SelectDetail } from "../src/base/events.js";

beforeAll(() => {
  if (!customElements.get("agentui-workflow-canvas")) {
    customElements.define("agentui-workflow-canvas", WorkflowCanvas);
  }
});

const DATA: WorkflowData = {
  nodes: [
    { id: "plan", label: "Planner", status: "success" },
    { id: "tool", label: "Search tool", status: "running" },
    { id: "mem", label: "Memory", status: "idle" },
    { id: "resp", label: "Response", status: "waiting" },
  ],
  edges: [
    { id: "e1", from: "plan", to: "tool" },
    { id: "e2", from: "tool", to: "mem" },
    { id: "e3", from: "mem", to: "resp", label: "context" },
  ],
};

function mount(data: WorkflowData): WorkflowCanvas {
  const el = document.createElement("agentui-workflow-canvas") as WorkflowCanvas;
  document.body.append(el);
  el.data = data;
  el.renderNow();
  return el;
}

describe("agentui-workflow-canvas", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("agentui-workflow-canvas")).toBe(WorkflowCanvas);
  });

  it("renders a node per data item with status classes", () => {
    const el = mount(DATA);
    const nodes = el.shadowRoot!.querySelectorAll("[data-node-id]");
    expect(nodes.length).toBe(4);
    const running = el.shadowRoot!.querySelector('[data-node-id="tool"]');
    expect(running?.classList.contains("status-running")).toBe(true);
  });

  it("renders edges connecting nodes", () => {
    const el = mount(DATA);
    const edges = el.shadowRoot!.querySelectorAll("[data-edge-id]");
    expect(edges.length).toBe(3);
  });

  it("auto-lays-out nodes into left-to-right layers", () => {
    const el = mount(DATA);
    const plan = el.shadowRoot!.querySelector('[data-node-id="plan"]')!;
    const tool = el.shadowRoot!.querySelector('[data-node-id="tool"]')!;
    const planX = Number(plan.getAttribute("transform")!.match(/translate\(([\d.]+)/)![1]);
    const toolX = Number(tool.getAttribute("transform")!.match(/translate\(([\d.]+)/)![1]);
    expect(toolX).toBeGreaterThan(planX);
  });

  it("emits agentui:select with node detail on activation", () => {
    const el = mount(DATA);
    let detail: SelectDetail | null = null;
    el.addEventListener("agentui:select", (e) => {
      detail = (e as CustomEvent<SelectDetail>).detail;
    });
    const node = el.shadowRoot!.querySelector('[data-node-id="plan"] [data-activate], [data-node-id="plan"]')!;
    (node as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("plan");
    expect(detail!.kind).toBe("node");
  });

  it("activates a node via keyboard (Enter)", () => {
    const el = mount(DATA);
    let count = 0;
    el.addEventListener("agentui:select", () => count++);
    const node = el.shadowRoot!.querySelector('[data-node-id="resp"]')!;
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(count).toBe(1);
  });

  it("marks the selected node aria-selected", () => {
    const el = mount(DATA);
    el.selectById("mem");
    const node = el.shadowRoot!.querySelector('[data-node-id="mem"]')!;
    expect(node.getAttribute("aria-selected")).toBe("true");
  });

  it("shows an empty state when there are no nodes", () => {
    const el = mount({ nodes: [] });
    expect(el.shadowRoot!.querySelector(".agentui-state")?.textContent).toMatch(/no workflow/i);
  });

  it("makes interactive parts keyboard reachable (tabindex)", () => {
    const el = mount(DATA);
    const node = el.shadowRoot!.querySelector('[data-node-id="plan"]')!;
    expect(node.getAttribute("tabindex")).toBe("0");
    expect(node.getAttribute("role")).toBe("button");
    expect(node.getAttribute("aria-label")).toBeTruthy();
  });
});
