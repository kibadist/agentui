import { describe, it, expect, beforeAll } from "vitest";
import { StateMachine } from "../src/components/state-machine.js";
import type { MachineData } from "../src/types.js";
import type { SelectDetail } from "../src/base/events.js";

beforeAll(() => {
  if (!customElements.get("agentui-state-machine")) {
    customElements.define("agentui-state-machine", StateMachine);
  }
});

const DATA: MachineData = {
  states: [
    { id: "idle", label: "Idle" },
    { id: "planning", label: "Planning", status: "planning" },
    { id: "running", label: "Running", status: "running" },
    { id: "waiting", label: "Waiting", status: "waiting" },
    { id: "done", label: "Complete", status: "success" },
  ],
  transitions: [
    { id: "t1", from: "idle", to: "planning" },
    { id: "t2", from: "planning", to: "running" },
    { id: "t3", from: "running", to: "waiting", label: "approval" },
    { id: "t4", from: "waiting", to: "done" },
  ],
  active: "running",
};

function mount(data: MachineData, layout?: "horizontal" | "radial"): StateMachine {
  const el = document.createElement("agentui-state-machine") as StateMachine;
  if (layout) el.setAttribute("layout", layout);
  document.body.append(el);
  el.data = data;
  el.renderNow();
  return el;
}

function nodeX(el: StateMachine, id: string): number {
  const g = el.shadowRoot!.querySelector(`[data-state-id="${id}"]`)!;
  return Number(g.getAttribute("transform")!.match(/translate\(([\d.-]+)/)![1]);
}

function nodeY(el: StateMachine, id: string): number {
  const g = el.shadowRoot!.querySelector(`[data-state-id="${id}"]`)!;
  return Number(g.getAttribute("transform")!.match(/translate\([\d.-]+ ([\d.-]+)/)![1]);
}

describe("agentui-state-machine", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("agentui-state-machine")).toBe(StateMachine);
  });

  it("renders one node per state", () => {
    const el = mount(DATA);
    const nodes = el.shadowRoot!.querySelectorAll("[data-state-id]");
    expect(nodes.length).toBe(5);
  });

  it("marks the active state with aria-current and a glow filter", () => {
    const el = mount(DATA);
    const active = el.shadowRoot!.querySelector('[data-state-id="running"]')!;
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(active.getAttribute("filter")).toMatch(/glow/);
    const inactive = el.shadowRoot!.querySelector('[data-state-id="idle"]')!;
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });

  it("applies status classes per state", () => {
    const el = mount(DATA);
    const running = el.shadowRoot!.querySelector('[data-state-id="running"]')!;
    expect(running.classList.contains("status-running")).toBe(true);
    const done = el.shadowRoot!.querySelector('[data-state-id="done"]')!;
    expect(done.classList.contains("status-success")).toBe(true);
  });

  it("renders transitions between states", () => {
    const el = mount(DATA);
    const edges = el.shadowRoot!.querySelectorAll("[data-transition-id]");
    expect(edges.length).toBe(4);
    // Arrowheads are drawn via a marker-end reference.
    const path = edges[0]!.querySelector(".sm-edge")!;
    expect(path.getAttribute("marker-end")).toMatch(/arrow/);
  });

  it("orders states left-to-right in horizontal layout", () => {
    const el = mount(DATA, "horizontal");
    const xs = ["idle", "planning", "running", "waiting", "done"].map((id) =>
      nodeX(el, id),
    );
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    }
  });

  it("arranges states on a circle in radial layout (ys differ)", () => {
    const el = mount(DATA, "radial");
    const ys = ["idle", "planning", "running", "waiting", "done"].map((id) =>
      nodeY(el, id),
    );
    const distinct = new Set(ys.map((y) => Math.round(y)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("emits agentui:select with kind state and correct id + data", () => {
    const el = mount(DATA);
    let detail: SelectDetail | null = null;
    el.addEventListener("agentui:select", (e) => {
      detail = (e as CustomEvent<SelectDetail>).detail;
    });
    const node = el.shadowRoot!.querySelector('[data-state-id="planning"]')!;
    (node as unknown as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("planning");
    expect(detail!.kind).toBe("state");
    expect((detail!.data as { label: string }).label).toBe("Planning");
  });

  it("activates a state via keyboard (Enter)", () => {
    const el = mount(DATA);
    let count = 0;
    el.addEventListener("agentui:select", () => count++);
    const node = el.shadowRoot!.querySelector('[data-state-id="done"]')!;
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    expect(count).toBe(1);
  });

  it("marks the selected state aria-selected", () => {
    const el = mount(DATA);
    el.selectById("waiting");
    const node = el.shadowRoot!.querySelector('[data-state-id="waiting"]')!;
    expect(node.getAttribute("aria-selected")).toBe("true");
  });

  it("setActive(id) moves the active marker", () => {
    const el = mount(DATA);
    el.setActive("done");
    el.renderNow();
    const done = el.shadowRoot!.querySelector('[data-state-id="done"]')!;
    expect(done.getAttribute("aria-current")).toBe("true");
    const prev = el.shadowRoot!.querySelector('[data-state-id="running"]')!;
    expect(prev.getAttribute("aria-current")).toBeNull();
  });

  it("shows an empty state when there are no states", () => {
    const el = mount({ states: [] });
    expect(el.shadowRoot!.querySelector(".agentui-state")?.textContent).toMatch(
      /no states/i,
    );
  });

  it("makes interactive states keyboard reachable (tabindex / role / aria-label)", () => {
    const el = mount(DATA);
    const node = el.shadowRoot!.querySelector('[data-state-id="idle"]')!;
    expect(node.getAttribute("tabindex")).toBe("0");
    expect(node.getAttribute("role")).toBe("button");
    expect(node.getAttribute("aria-label")).toBeTruthy();
  });
});
