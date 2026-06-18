// ─── agentui-review-checkpoint ───────────────────────────────────────────────
//
// Renders a human approval gate card with a level emblem (low/medium/high) and
// action buttons (continue / stop / revise). The card is an HTML overlay inside
// the shadow DOM — real <button> and <textarea> elements for native keyboard
// accessibility. An SVG emblem in the header communicates emphasis visually.
//
// Public API:
//   const el = document.createElement("agentui-review-checkpoint");
//   el.data = {
//     title: "Send 1,204 emails?",
//     description: "Campaign will send immediately.",
//     level: "high",
//     summary: "1,204 recipients · template: launch-v2",
//     actions: ["continue", "stop"],  // optional — defaults to all three
//   };
//   el.addEventListener("agentui:decision", (e) => {
//     console.log(e.detail.action, e.detail.note);
//   });
//
// Attributes:
//   level="low|medium|high" — overrides data.level for quick imperative use
//   disabled                — disables all actions and the note textarea
//   loading                 — shows a spinner, disables all actions
//
// Events: agentui:decision { action: "continue"|"stop"|"revise", note? }
// Slot:   <slot name="preview"> — project preview content beside the card

import { AgentUIElement } from "../base/element.js";
import { svg, html, clear } from "../base/dom.js";
import { AGENTUI_EVENT } from "../base/events.js";
import type { CheckpointData, ReviewAction, AgentLevel } from "../types.js";

// ── Level config ───────────────────────────────────────────────────────────────

interface LevelConfig {
  color: string;
  borderColor: string;
  iconPaths: string[];
  label: string;
}

const LEVEL_CONFIG: Record<AgentLevel, LevelConfig> = {
  low: {
    color: "var(--agentui-status-idle)",
    borderColor: "var(--agentui-border)",
    iconPaths: [
      "M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2zm0 9v5",
      "M12 8v.5",
    ],
    label: "Low priority",
  },
  medium: {
    color: "var(--agentui-status-waiting)",
    borderColor: "var(--agentui-status-waiting)",
    iconPaths: [
      "M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2z",
      "M12 8v5M12 16v.5",
    ],
    label: "Medium priority",
  },
  high: {
    color: "var(--agentui-status-blocked)",
    borderColor: "var(--agentui-status-blocked)",
    iconPaths: [
      "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
      "M12 9v5M12 17v.5",
    ],
    label: "High priority — review carefully",
  },
};

const ALL_ACTIONS: ReviewAction[] = ["continue", "stop", "revise"];

const ACTION_LABEL: Record<ReviewAction, string> = {
  continue: "Continue",
  stop: "Stop",
  revise: "Revise",
};

export class ReviewCheckpoint extends AgentUIElement<CheckpointData> {
  private noteEl: HTMLTextAreaElement | null = null;

  static override get observedAttributes(): string[] {
    return ["data", "level", "disabled", "loading"];
  }

  override attributeChangedCallback(
    name: string,
    old: string | null,
    value: string | null,
  ): void {
    super.attributeChangedCallback(name, old, value);
    if (name === "level" || name === "disabled" || name === "loading") {
      this.scheduleRender();
    }
  }

  private get effectiveLevel(): AgentLevel {
    const attr = this.getAttribute("level") as AgentLevel | null;
    if (attr === "low" || attr === "medium" || attr === "high") return attr;
    const dataLevel = this.data?.level;
    if (dataLevel === "low" || dataLevel === "medium" || dataLevel === "high") {
      return dataLevel;
    }
    return "medium";
  }

  private get isDisabled(): boolean {
    return this.hasAttribute("disabled");
  }

  private get isLoading(): boolean {
    return this.hasAttribute("loading");
  }

  protected componentCss(): string {
    return /* css */ `
      .rc-wrapper {
        display: flex;
        flex-wrap: wrap;
        gap: var(--agentui-space);
        align-items: flex-start;
        padding: var(--agentui-space);
      }
      .rc-card {
        flex: 1 1 280px;
        background: var(--agentui-surface);
        border: var(--agentui-stroke) solid var(--rc-border, var(--agentui-border));
        border-left: 4px solid var(--rc-border, var(--agentui-border));
        border-radius: var(--agentui-radius);
        box-shadow: var(--agentui-shadow);
        padding: var(--agentui-space);
        display: flex;
        flex-direction: column;
        gap: var(--agentui-space-sm);
      }
      .rc-header {
        display: flex;
        align-items: center;
        gap: var(--agentui-space-sm);
      }
      .rc-emblem {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
      }
      .rc-title {
        font-weight: 600;
        font-size: var(--agentui-font-size);
        color: var(--agentui-fg);
        margin: 0;
        flex: 1;
      }
      .rc-description {
        color: var(--agentui-fg-muted);
        font-size: var(--agentui-font-size-sm);
        margin: 0;
        line-height: 1.5;
      }
      .rc-summary {
        color: var(--agentui-fg-muted);
        font-size: var(--agentui-font-size-sm);
        font-style: italic;
        margin: 0;
        padding-top: var(--agentui-space-sm);
        border-top: 1px solid var(--agentui-border);
      }
      .rc-note {
        width: 100%;
        min-height: 64px;
        resize: vertical;
        padding: var(--agentui-space-sm);
        border: var(--agentui-stroke) solid var(--agentui-border);
        border-radius: var(--agentui-radius-sm);
        background: var(--agentui-bg);
        color: var(--agentui-fg);
        font-family: var(--agentui-font);
        font-size: var(--agentui-font-size-sm);
        box-sizing: border-box;
      }
      .rc-note:focus-visible {
        outline: var(--agentui-focus-ring-width) solid var(--agentui-focus-ring);
        outline-offset: 1px;
      }
      .rc-note:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .rc-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--agentui-space-sm);
        margin-top: var(--agentui-space-sm);
      }
      .rc-btn {
        padding: 5px var(--agentui-space);
        border-radius: var(--agentui-radius-sm);
        border: var(--agentui-stroke) solid var(--agentui-border);
        background: var(--agentui-surface-2);
        color: var(--agentui-fg);
        font-family: var(--agentui-font);
        font-size: var(--agentui-font-size-sm);
        font-weight: 500;
        cursor: pointer;
        transition: background 0.1s, border-color 0.1s;
      }
      .rc-btn:hover:not(:disabled) {
        background: var(--agentui-surface);
        border-color: var(--agentui-fg-muted);
      }
      .rc-btn:focus-visible {
        outline: var(--agentui-focus-ring-width) solid var(--agentui-focus-ring);
        outline-offset: 2px;
      }
      .rc-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .rc-btn-continue {
        background: var(--agentui-accent);
        color: var(--agentui-accent-contrast);
        border-color: var(--agentui-accent);
      }
      .rc-btn-continue:hover:not(:disabled) {
        opacity: 0.88;
        background: var(--agentui-accent);
      }
      .rc-btn-stop {
        border-color: var(--agentui-status-failed);
        color: var(--agentui-status-failed);
      }
      .rc-btn-stop:hover:not(:disabled) {
        background: color-mix(in srgb, var(--agentui-status-failed) 8%, transparent);
      }
      .rc-loading {
        display: flex;
        align-items: center;
        gap: var(--agentui-space-sm);
        color: var(--agentui-fg-muted);
        font-size: var(--agentui-font-size-sm);
        padding-top: var(--agentui-space-sm);
      }
      .rc-spinner {
        animation: rc-spin 0.8s linear infinite;
        flex-shrink: 0;
      }
      @keyframes rc-spin {
        to { transform: rotate(360deg); }
      }
      .rc-preview {
        flex: 1 1 200px;
      }
    `;
  }

  protected render(): void {
    this.resetScene();
    this.noteEl = null;

    const data = this.data;
    const level = this.effectiveLevel;
    const cfg = LEVEL_CONFIG[level];
    const disabled = this.isDisabled;
    const loading = this.isLoading;
    const actionsToShow = data?.actions ?? ALL_ACTIONS;

    // ── Wrapper (card + optional preview slot) ─────────────────────────────
    const wrapper = html("div", { class: "rc-wrapper" });

    // ── Card ───────────────────────────────────────────────────────────────
    const card = html("div", {
      class: "rc-card",
      role: "region",
      "aria-label": data?.title ?? "Review checkpoint",
      style: `--rc-border: ${cfg.borderColor}`,
    });

    // Header: emblem + title
    const header = html("div", { class: "rc-header" });
    header.append(this.buildEmblem(level, cfg));

    const titleEl = html("p", { class: "rc-title" });
    titleEl.textContent = data?.title ?? "";
    header.append(titleEl);
    card.append(header);

    // Description
    if (data?.description) {
      const desc = html("p", { class: "rc-description" });
      desc.textContent = data.description;
      card.append(desc);
    }

    // Summary
    if (data?.summary) {
      const sum = html("p", { class: "rc-summary" });
      sum.textContent = data.summary;
      card.append(sum);
    }

    // Note textarea
    const note = html("textarea", {
      class: "rc-note",
      placeholder: "Optional note…",
      "aria-label": "Review note",
    }) as HTMLTextAreaElement;
    if (disabled || loading) note.setAttribute("disabled", "");
    card.append(note);
    this.noteEl = note;

    // Actions
    if (loading) {
      card.append(this.buildLoading());
    } else {
      const actions = html("div", { class: "rc-actions", role: "group", "aria-label": "Review actions" });
      for (const action of actionsToShow) {
        actions.append(this.buildButton(action, disabled));
      }
      card.append(actions);
    }

    wrapper.append(card);

    // ── Preview slot ───────────────────────────────────────────────────────
    const previewSlot = html("div", { class: "rc-preview" });
    const slot = document.createElement("slot");
    slot.setAttribute("name", "preview");
    previewSlot.append(slot);
    wrapper.append(previewSlot);

    this.mount.append(wrapper);
  }

  private buildEmblem(level: AgentLevel, cfg: LevelConfig): SVGSVGElement {
    const s = svg("svg", {
      class: "rc-emblem",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: cfg.color,
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-label": cfg.label,
      role: "img",
    });

    for (const d of cfg.iconPaths) {
      s.append(svg("path", { d }));
    }

    // High level gets a filled background circle for extra emphasis.
    if (level === "high") {
      const circle = svg("circle", {
        cx: 12,
        cy: 12,
        r: 11,
        fill: "color-mix(in srgb, var(--agentui-status-blocked) 12%, transparent)",
        stroke: "none",
      });
      s.prepend(circle);
    }

    return s;
  }

  private buildButton(action: ReviewAction, disabled: boolean): HTMLButtonElement {
    const btn = html("button", {
      class: `rc-btn rc-btn-${action}`,
      type: "button",
      "data-action": action,
      "aria-label": ACTION_LABEL[action],
    }) as HTMLButtonElement;
    btn.textContent = ACTION_LABEL[action];
    if (disabled) {
      btn.setAttribute("disabled", "");
      btn.setAttribute("aria-disabled", "true");
    }
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handleAction(action);
    });
    return btn;
  }

  private buildLoading(): HTMLElement {
    const wrap = html("div", { class: "rc-loading", "aria-live": "polite", "aria-label": "Loading" });
    const spinner = svg("svg", {
      class: "rc-spinner",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      width: 16,
      height: 16,
      "aria-hidden": "true",
    });
    spinner.append(
      svg("path", {
        d: "M12 2a10 10 0 0 1 10 10",
        "stroke-linecap": "round",
      }),
    );
    wrap.append(spinner);
    const text = document.createTextNode("Processing…");
    wrap.append(text);
    return wrap;
  }

  private handleAction(action: ReviewAction): void {
    if (this.isDisabled || this.isLoading) return;
    const noteVal = this.noteEl?.value.trim();
    this.emit(AGENTUI_EVENT.decision, {
      action,
      ...(noteVal ? { note: noteVal } : {}),
    });
  }

  // Base class uses event delegation via data-activate for SVG elements.
  // Our buttons are native HTML so they receive clicks directly.
  // onActivate is required by the base class but unused here.
  protected onActivate(_el: Element, _event: Event): void {
    // No SVG interactive elements — all interaction is via native buttons.
  }

  // Override resetScene to also clear noteEl reference.
  protected override resetScene(): void {
    clear(this.mount);
    this.noteEl = null;
  }
}
