import { describe, it, expect, beforeAll } from "vitest";
import { ReviewCheckpoint } from "../src/components/review-checkpoint.js";
import type { CheckpointData } from "../src/types.js";
import type { DecisionDetail } from "../src/base/events.js";

beforeAll(() => {
  if (!customElements.get("agentui-review-checkpoint")) {
    customElements.define("agentui-review-checkpoint", ReviewCheckpoint);
  }
});

const DATA: CheckpointData = {
  title: "Send 1,204 emails?",
  description: "Campaign will send immediately and cannot be recalled.",
  level: "high",
  summary: "1,204 recipients · template: launch-v2",
};

function mount(data: CheckpointData, attrs: Record<string, string> = {}): ReviewCheckpoint {
  const el = document.createElement("agentui-review-checkpoint") as ReviewCheckpoint;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.body.append(el);
  el.data = data;
  el.renderNow();
  return el;
}

describe("agentui-review-checkpoint", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("agentui-review-checkpoint")).toBe(ReviewCheckpoint);
  });

  it("renders the title", () => {
    const el = mount(DATA);
    const title = el.shadowRoot!.querySelector(".rc-title");
    expect(title?.textContent).toBe("Send 1,204 emails?");
  });

  it("renders the description", () => {
    const el = mount(DATA);
    const desc = el.shadowRoot!.querySelector(".rc-description");
    expect(desc?.textContent).toBe("Campaign will send immediately and cannot be recalled.");
  });

  it("renders the summary", () => {
    const el = mount(DATA);
    const sum = el.shadowRoot!.querySelector(".rc-summary");
    expect(sum?.textContent).toBe("1,204 recipients · template: launch-v2");
  });

  it("omits description element when not provided", () => {
    const el = mount({ title: "Go?" });
    el.renderNow();
    expect(el.shadowRoot!.querySelector(".rc-description")).toBeNull();
  });

  it("omits summary element when not provided", () => {
    const el = mount({ title: "Go?" });
    el.renderNow();
    expect(el.shadowRoot!.querySelector(".rc-summary")).toBeNull();
  });

  // ── Level emblem ──────────────────────────────────────────────────────────

  it("renders the SVG emblem with level aria-label for 'high'", () => {
    const el = mount({ ...DATA, level: "high" });
    const emblem = el.shadowRoot!.querySelector(".rc-emblem");
    expect(emblem).not.toBeNull();
    expect(emblem?.getAttribute("aria-label")).toMatch(/high/i);
  });

  it("renders a different emblem aria-label for 'medium'", () => {
    const el = mount({ ...DATA, level: "medium" });
    const emblem = el.shadowRoot!.querySelector(".rc-emblem");
    expect(emblem?.getAttribute("aria-label")).toMatch(/medium/i);
  });

  it("renders a different emblem aria-label for 'low'", () => {
    const el = mount({ ...DATA, level: "low" });
    const emblem = el.shadowRoot!.querySelector(".rc-emblem");
    expect(emblem?.getAttribute("aria-label")).toMatch(/low/i);
  });

  it("level attribute overrides data.level", () => {
    const el = mount({ ...DATA, level: "high" }, { level: "low" });
    const emblem = el.shadowRoot!.querySelector(".rc-emblem");
    expect(emblem?.getAttribute("aria-label")).toMatch(/low/i);
  });

  it("high level emblem includes a background circle for extra emphasis", () => {
    const el = mount({ ...DATA, level: "high" });
    const circle = el.shadowRoot!.querySelector(".rc-emblem circle");
    expect(circle).not.toBeNull();
  });

  it("low level emblem does not include the background circle", () => {
    const el = mount({ ...DATA, level: "low" });
    const circle = el.shadowRoot!.querySelector(".rc-emblem circle");
    expect(circle).toBeNull();
  });

  // ── Action buttons ────────────────────────────────────────────────────────

  it("renders all three action buttons by default", () => {
    const el = mount(DATA);
    const buttons = el.shadowRoot!.querySelectorAll(".rc-btn");
    expect(buttons.length).toBe(3);
  });

  it("renders continue button", () => {
    const el = mount(DATA);
    expect(el.shadowRoot!.querySelector(".rc-btn-continue")).not.toBeNull();
  });

  it("renders stop button", () => {
    const el = mount(DATA);
    expect(el.shadowRoot!.querySelector(".rc-btn-stop")).not.toBeNull();
  });

  it("renders revise button", () => {
    const el = mount(DATA);
    expect(el.shadowRoot!.querySelector(".rc-btn-revise")).not.toBeNull();
  });

  it("restricting actions to ['continue','stop'] hides revise", () => {
    const el = mount({ ...DATA, actions: ["continue", "stop"] });
    expect(el.shadowRoot!.querySelector(".rc-btn-revise")).toBeNull();
    expect(el.shadowRoot!.querySelector(".rc-btn-continue")).not.toBeNull();
    expect(el.shadowRoot!.querySelector(".rc-btn-stop")).not.toBeNull();
  });

  it("restricting actions to ['revise'] shows only revise", () => {
    const el = mount({ ...DATA, actions: ["revise"] });
    const buttons = el.shadowRoot!.querySelectorAll(".rc-btn");
    expect(buttons.length).toBe(1);
    expect(el.shadowRoot!.querySelector(".rc-btn-revise")).not.toBeNull();
  });

  // ── Decision events ───────────────────────────────────────────────────────

  it("clicking continue emits agentui:decision with action='continue'", () => {
    const el = mount(DATA);
    let detail: DecisionDetail | null = null;
    el.addEventListener("agentui:decision", (e) => {
      detail = (e as CustomEvent<DecisionDetail>).detail;
    });
    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>(".rc-btn-continue")!;
    btn.click();
    expect(detail).not.toBeNull();
    expect(detail!.action).toBe("continue");
  });

  it("clicking stop emits agentui:decision with action='stop'", () => {
    const el = mount(DATA);
    let detail: DecisionDetail | null = null;
    el.addEventListener("agentui:decision", (e) => {
      detail = (e as CustomEvent<DecisionDetail>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>(".rc-btn-stop")!.click();
    expect(detail!.action).toBe("stop");
  });

  it("clicking revise emits agentui:decision with action='revise'", () => {
    const el = mount(DATA);
    let detail: DecisionDetail | null = null;
    el.addEventListener("agentui:decision", (e) => {
      detail = (e as CustomEvent<DecisionDetail>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>(".rc-btn-revise")!.click();
    expect(detail!.action).toBe("revise");
  });

  // ── Note textarea ─────────────────────────────────────────────────────────

  it("renders a textarea for the optional note", () => {
    const el = mount(DATA);
    expect(el.shadowRoot!.querySelector("textarea.rc-note")).not.toBeNull();
  });

  it("includes note in decision detail when textarea has a value", () => {
    const el = mount(DATA);
    let detail: DecisionDetail | null = null;
    el.addEventListener("agentui:decision", (e) => {
      detail = (e as CustomEvent<DecisionDetail>).detail;
    });
    const textarea = el.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea.rc-note")!;
    textarea.value = "Please double-check the list.";
    el.shadowRoot!.querySelector<HTMLButtonElement>(".rc-btn-continue")!.click();
    expect(detail!.note).toBe("Please double-check the list.");
  });

  it("omits note from detail when textarea is empty", () => {
    const el = mount(DATA);
    let detail: DecisionDetail | null = null;
    el.addEventListener("agentui:decision", (e) => {
      detail = (e as CustomEvent<DecisionDetail>).detail;
    });
    el.shadowRoot!.querySelector<HTMLButtonElement>(".rc-btn-continue")!.click();
    expect(detail!.note).toBeUndefined();
  });

  it("omits note from detail when textarea is whitespace only", () => {
    const el = mount(DATA);
    let detail: DecisionDetail | null = null;
    el.addEventListener("agentui:decision", (e) => {
      detail = (e as CustomEvent<DecisionDetail>).detail;
    });
    const textarea = el.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea.rc-note")!;
    textarea.value = "   ";
    el.shadowRoot!.querySelector<HTMLButtonElement>(".rc-btn-continue")!.click();
    expect(detail!.note).toBeUndefined();
  });

  // ── Disabled state ────────────────────────────────────────────────────────

  it("disabled attribute disables all buttons", () => {
    const el = mount(DATA, { disabled: "" });
    const buttons = el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".rc-btn");
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.disabled).toBe(true);
    }
  });

  it("disabled attribute disables the textarea", () => {
    const el = mount(DATA, { disabled: "" });
    const textarea = el.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea.rc-note")!;
    expect(textarea.disabled).toBe(true);
  });

  it("disabled buttons carry aria-disabled='true'", () => {
    const el = mount(DATA, { disabled: "" });
    const buttons = el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".rc-btn");
    for (const btn of buttons) {
      expect(btn.getAttribute("aria-disabled")).toBe("true");
    }
  });

  it("disabled state suppresses decision events", () => {
    const el = mount(DATA, { disabled: "" });
    let fired = false;
    el.addEventListener("agentui:decision", () => { fired = true; });
    // Programmatically call handleAction by simulating a click on the (disabled) button.
    // Native disabled buttons don't fire click, so we test via renderNow + the guard.
    // Temporarily re-enable to get a reference, then test the guard directly.
    el.removeAttribute("disabled");
    el.renderNow();
    // Re-add disabled and try:
    el.setAttribute("disabled", "");
    el.renderNow();
    // Buttons are now natively disabled — click events won't fire from them.
    // Verify no event fires when we try to dispatch a click artificially:
    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>(".rc-btn-continue")!;
    // Native disabled button: click() is a no-op in browsers / jsdom.
    btn.click();
    expect(fired).toBe(false);
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  it("loading attribute shows the loading indicator", () => {
    const el = mount(DATA, { loading: "" });
    expect(el.shadowRoot!.querySelector(".rc-loading")).not.toBeNull();
  });

  it("loading attribute hides the action buttons", () => {
    const el = mount(DATA, { loading: "" });
    expect(el.shadowRoot!.querySelector(".rc-btn")).toBeNull();
  });

  it("loading attribute disables the textarea", () => {
    const el = mount(DATA, { loading: "" });
    const textarea = el.shadowRoot!.querySelector<HTMLTextAreaElement>("textarea.rc-note")!;
    expect(textarea.disabled).toBe(true);
  });

  // ── Keyboard / accessibility ──────────────────────────────────────────────

  it("action buttons are native <button> elements (natively keyboard-focusable)", () => {
    const el = mount(DATA);
    const buttons = el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".rc-btn");
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.tagName.toLowerCase()).toBe("button");
      // Native buttons have tabIndex=0 by default.
      expect(btn.tabIndex).toBe(0);
    }
  });

  it("action buttons have accessible labels", () => {
    const el = mount(DATA);
    const buttons = el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".rc-btn");
    for (const btn of buttons) {
      expect(btn.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("renders a preview slot", () => {
    const el = mount(DATA);
    const slot = el.shadowRoot!.querySelector("slot[name='preview']");
    expect(slot).not.toBeNull();
  });

  it("card has a region role with aria-label", () => {
    const el = mount(DATA);
    const card = el.shadowRoot!.querySelector(".rc-card");
    expect(card?.getAttribute("role")).toBe("region");
    expect(card?.getAttribute("aria-label")).toBeTruthy();
  });
});
