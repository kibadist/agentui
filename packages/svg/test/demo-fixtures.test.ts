// Validates that the demo page's sample data (demo/fixtures.js) renders through
// every component and that the cross-component methods the demo calls exist and
// work. This is the headless stand-in for opening demo/index.html in a browser.
import { describe, it, expect, beforeAll } from "vitest";
import {
  WorkflowCanvas,
  ToolTimeline,
  ReviewCheckpoint,
  MemoryMap,
  StateMachine,
  registerAll,
} from "../src/index.js";
// @ts-expect-error — plain-JS demo fixtures, no type declarations.
import { workflow, timeline, checkpoint, memory, machine } from "../demo/fixtures.js";

beforeAll(() => {
  registerAll();
});

function mount<T extends HTMLElement>(tag: string, data: unknown): T {
  const el = document.createElement(tag) as T & { data?: unknown; renderNow?: () => void };
  document.body.append(el);
  el.data = data;
  el.renderNow?.();
  return el as T;
}

describe("demo fixtures render through every component", () => {
  it("registers all five tags", () => {
    expect(customElements.get("agentui-workflow-canvas")).toBe(WorkflowCanvas);
    expect(customElements.get("agentui-tool-timeline")).toBe(ToolTimeline);
    expect(customElements.get("agentui-review-checkpoint")).toBe(ReviewCheckpoint);
    expect(customElements.get("agentui-memory-map")).toBe(MemoryMap);
    expect(customElements.get("agentui-state-machine")).toBe(StateMachine);
  });

  it("workflow canvas renders all fixture nodes", () => {
    const el = mount<WorkflowCanvas>("agentui-workflow-canvas", workflow);
    expect(el.shadowRoot!.querySelectorAll("[data-node-id]").length).toBe(workflow.nodes.length);
  });

  it("tool timeline renders all fixture items", () => {
    const el = mount<ToolTimeline>("agentui-tool-timeline", timeline);
    expect(el.shadowRoot!.querySelectorAll("[data-item-id]").length).toBe(timeline.items.length);
  });

  it("review checkpoint renders the fixture title", () => {
    const el = mount<ReviewCheckpoint>("agentui-review-checkpoint", checkpoint);
    expect(el.shadowRoot!.textContent).toContain(checkpoint.title);
  });

  it("memory map renders all fixture nodes", () => {
    const el = mount<MemoryMap>("agentui-memory-map", memory);
    expect(el.shadowRoot!.querySelectorAll("[data-node-id]").length).toBe(memory.nodes.length);
  });

  it("state machine renders all fixture states", () => {
    const el = mount<StateMachine>("agentui-state-machine", machine);
    expect(el.shadowRoot!.querySelectorAll("[data-state-id]").length).toBe(machine.states.length);
  });

  it("exposes the cross-component methods the demo wires up", () => {
    const canvas = mount<WorkflowCanvas>("agentui-workflow-canvas", workflow);
    const tl = mount<ToolTimeline>("agentui-tool-timeline", timeline);
    const sm = mount<StateMachine>("agentui-state-machine", machine);
    expect(typeof canvas.resetView).toBe("function");
    expect(typeof tl.selectById).toBe("function");
    expect(typeof sm.setActive).toBe("function");
    // Exercise them (they must not throw).
    expect(() => canvas.resetView()).not.toThrow();
    expect(() => tl.selectById("plan")).not.toThrow();
    expect(() => sm.setActive("waiting")).not.toThrow();
  });
});
