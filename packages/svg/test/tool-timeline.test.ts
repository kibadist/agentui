import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ToolTimeline } from "../src/components/tool-timeline.js";
import type { TimelineData } from "../src/types.js";
import type { SelectDetail } from "../src/base/events.js";

beforeAll(() => {
  if (!customElements.get("agentui-tool-timeline")) {
    customElements.define("agentui-tool-timeline", ToolTimeline);
  }
});

afterEach(() => {
  // Clean up mounted elements after each test.
  document.body.querySelectorAll("agentui-tool-timeline").forEach((el) => el.remove());
});

const DATA: TimelineData = {
  items: [
    { id: "plan",   label: "plan",       status: "success", durationMs: 120 },
    { id: "search", label: "web.search", status: "running", durationMs: 820, detail: "3 results" },
    { id: "query",  label: "db.query",   status: "failed",  durationMs: 40 },
    { id: "mem",    label: "memory",     status: "skipped" },
    { id: "block",  label: "blocked op", status: "blocked" },
  ],
};

function mount(data: TimelineData, attrs: Record<string, string> = {}): ToolTimeline {
  const el = document.createElement("agentui-tool-timeline") as ToolTimeline;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  el.data = data;
  el.renderNow();
  return el;
}

describe("agentui-tool-timeline", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("agentui-tool-timeline")).toBe(ToolTimeline);
  });

  it("renders one marker row per item", () => {
    const el = mount(DATA);
    const rows = el.shadowRoot!.querySelectorAll("[data-item-id]");
    expect(rows.length).toBe(DATA.items.length);
  });

  it("applies status classes to each row", () => {
    const el = mount(DATA);
    expect(el.shadowRoot!.querySelector('[data-item-id="plan"]')?.classList.contains("status-success")).toBe(true);
    expect(el.shadowRoot!.querySelector('[data-item-id="search"]')?.classList.contains("status-running")).toBe(true);
    expect(el.shadowRoot!.querySelector('[data-item-id="query"]')?.classList.contains("status-failed")).toBe(true);
    expect(el.shadowRoot!.querySelector('[data-item-id="mem"]')?.classList.contains("status-skipped")).toBe(true);
    expect(el.shadowRoot!.querySelector('[data-item-id="block"]')?.classList.contains("status-blocked")).toBe(true);
  });

  it("shows a duration chip when durationMs is present", () => {
    const el = mount(DATA);
    const root = el.shadowRoot!;
    // "plan" has durationMs: 120 → expect "120ms"
    const planRow = root.querySelector('[data-item-id="plan"]')!;
    const chipText = planRow.querySelector(".tt-chip-text")?.textContent;
    expect(chipText).toBe("120ms");
    // "search" has durationMs: 820 → "820ms"
    const searchRow = root.querySelector('[data-item-id="search"]')!;
    expect(searchRow.querySelector(".tt-chip-text")?.textContent).toBe("820ms");
  });

  it("formats durations >= 1000ms as seconds", () => {
    const el = mount({ items: [{ id: "a", label: "slow", status: "success", durationMs: 1200 }] });
    const row = el.shadowRoot!.querySelector('[data-item-id="a"]')!;
    expect(row.querySelector(".tt-chip-text")?.textContent).toBe("1.2s");
  });

  it("does not render a chip when durationMs is absent", () => {
    const el = mount(DATA);
    const memRow = el.shadowRoot!.querySelector('[data-item-id="mem"]')!;
    expect(memRow.querySelector(".tt-chip-text")).toBeNull();
  });

  it("shows detail text in expanded density", () => {
    const el = mount(DATA); // default density = expanded
    const searchRow = el.shadowRoot!.querySelector('[data-item-id="search"]')!;
    const detail = searchRow.querySelector(".tt-detail");
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("3 results");
  });

  it("hides detail text in compact density", () => {
    const el = mount(DATA, { density: "compact" });
    const searchRow = el.shadowRoot!.querySelector('[data-item-id="search"]')!;
    expect(searchRow.querySelector(".tt-detail")).toBeNull();
  });

  it("compact density uses a tighter row layout (fewer svg height units)", () => {
    const expanded = mount(DATA);
    const compact = mount(DATA, { density: "compact" });
    const expandedH = Number(
      expanded.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(" ")[3],
    );
    const compactH = Number(
      compact.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(" ")[3],
    );
    expect(compactH).toBeLessThan(expandedH);
  });

  it("emits agentui:select on click with correct detail", () => {
    const el = mount(DATA);
    let detail: SelectDetail | null = null;
    el.addEventListener("agentui:select", (e) => {
      detail = (e as CustomEvent<SelectDetail>).detail;
    });
    const row = el.shadowRoot!.querySelector('[data-item-id="plan"]')!;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("plan");
    expect(detail!.kind).toBe("item");
    expect((detail!.data as TimelineData["items"][number]).label).toBe("plan");
  });

  it("activates via keyboard Enter", () => {
    const el = mount(DATA);
    let count = 0;
    el.addEventListener("agentui:select", () => count++);
    const row = el.shadowRoot!.querySelector('[data-item-id="query"]')!;
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(count).toBe(1);
  });

  it("activates via keyboard Space", () => {
    const el = mount(DATA);
    let count = 0;
    el.addEventListener("agentui:select", () => count++);
    const row = el.shadowRoot!.querySelector('[data-item-id="query"]')!;
    row.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true }));
    expect(count).toBe(1);
  });

  it("marks the selected item aria-selected", () => {
    const el = mount(DATA);
    el.selectById("search");
    const row = el.shadowRoot!.querySelector('[data-item-id="search"]')!;
    expect(row.getAttribute("aria-selected")).toBe("true");
  });

  it("clears aria-selected from previously selected item on new selection", () => {
    const el = mount(DATA);
    el.selectById("plan");
    el.selectById("search");
    expect(el.shadowRoot!.querySelector('[data-item-id="plan"]')!.getAttribute("aria-selected")).toBe("false");
    expect(el.shadowRoot!.querySelector('[data-item-id="search"]')!.getAttribute("aria-selected")).toBe("true");
  });

  it("selectById is a no-op for unknown ids", () => {
    const el = mount(DATA);
    let count = 0;
    el.addEventListener("agentui:select", () => count++);
    el.selectById("nonexistent");
    expect(count).toBe(0);
  });

  it("shows empty state when data has no items", () => {
    const el = mount({ items: [] });
    const state = el.shadowRoot!.querySelector(".agentui-state");
    expect(state).not.toBeNull();
    expect(state?.textContent).toMatch(/no timeline/i);
  });

  it("shows empty state when data is null", () => {
    const el = document.createElement("agentui-tool-timeline") as ToolTimeline;
    document.body.append(el);
    el.renderNow();
    const state = el.shadowRoot!.querySelector(".agentui-state");
    expect(state).not.toBeNull();
    expect(state?.textContent).toMatch(/no timeline/i);
  });

  it("shows loading state when loading attribute is present", () => {
    const el = mount(DATA, { loading: "" });
    const state = el.shadowRoot!.querySelector(".agentui-state");
    expect(state).not.toBeNull();
    expect(state?.textContent).toMatch(/loading/i);
    // No rows rendered during loading.
    expect(el.shadowRoot!.querySelectorAll("[data-item-id]").length).toBe(0);
  });

  it("shows error state when error attribute is present", () => {
    const el = mount(DATA, { error: "Network timeout" });
    const state = el.shadowRoot!.querySelector(".agentui-state");
    expect(state).not.toBeNull();
    expect(state?.textContent).toContain("Network timeout");
    expect(el.shadowRoot!.querySelectorAll("[data-item-id]").length).toBe(0);
  });

  it("shows generic error message when error attribute is empty string", () => {
    const el = mount(DATA, { error: "" });
    const state = el.shadowRoot!.querySelector(".agentui-state");
    expect(state).not.toBeNull();
    expect(state?.textContent).toBeTruthy();
  });

  it("interactive rows have tabindex, role, and aria-label", () => {
    const el = mount(DATA);
    const row = el.shadowRoot!.querySelector('[data-item-id="plan"]')!;
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("aria-label")).toBeTruthy();
  });

  it("aria-label includes status and duration", () => {
    const el = mount(DATA);
    const row = el.shadowRoot!.querySelector('[data-item-id="plan"]')!;
    const label = row.getAttribute("aria-label")!;
    expect(label).toContain("plan");
    expect(label).toContain("success");
    expect(label).toContain("120ms");
  });

  it("running items receive the glow filter", () => {
    const el = mount(DATA);
    const row = el.shadowRoot!.querySelector('[data-item-id="search"]')!;
    expect(row.getAttribute("filter")).toMatch(/agentui-glow/);
  });

  it("re-renders when density attribute changes", () => {
    const el = mount(DATA);
    // Expanded by default — detail is present.
    expect(el.shadowRoot!.querySelector(".tt-detail")).not.toBeNull();
    el.setAttribute("density", "compact");
    el.renderNow();
    expect(el.shadowRoot!.querySelector(".tt-detail")).toBeNull();
  });

  it("re-renders when loading attribute is added", () => {
    const el = mount(DATA);
    expect(el.shadowRoot!.querySelectorAll("[data-item-id]").length).toBe(DATA.items.length);
    el.setAttribute("loading", "");
    el.renderNow();
    expect(el.shadowRoot!.querySelectorAll("[data-item-id]").length).toBe(0);
    expect(el.shadowRoot!.querySelector(".agentui-state")?.textContent).toMatch(/loading/i);
  });

  it("spine line is rendered when there are multiple items", () => {
    const el = mount(DATA);
    expect(el.shadowRoot!.querySelector(".tt-spine")).not.toBeNull();
  });

  it("no spine line when there is only one item", () => {
    const el = mount({ items: [{ id: "solo", label: "solo", status: "success" }] });
    expect(el.shadowRoot!.querySelector(".tt-spine")).toBeNull();
  });
});
