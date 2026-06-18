// ─── agentui-tool-timeline ────────────────────────────────────────────────────
//
// Renders an ordered list of tool-call steps as a vertical SVG timeline: a
// spine line with one marker row per TimelineItem, each showing a status-
// colored dot, a label, and an optional duration chip.
//
// Public API:
//   const el = document.createElement("agentui-tool-timeline");
//   el.setAttribute("density", "compact"); // "compact" | "expanded" (default)
//   el.data = { items: [
//     { id: "1", label: "plan",       status: "success", durationMs: 120 },
//     { id: "2", label: "web.search", status: "running", durationMs: 820, detail: "3 results" },
//     { id: "3", label: "db.query",   status: "failed",  durationMs: 40 },
//   ]};
//   el.addEventListener("agentui:select", (e) => e.detail); // { id, kind: "item", data }
//   el.selectById("2");   // programmatic selection
//
// Attributes:
//   density  — "compact" (tighter rows, no detail text) | "expanded" (default, shows detail)
//   loading  — boolean; renders a loading state overlay
//   error    — string; renders an error state with the message
//
// Events: agentui:select (item).

import { AgentUIElement } from "../base/element.js";
import { svg, truncate, clear } from "../base/dom.js";
import { createScene } from "../base/scene.js";
import { makeInteractive } from "../base/a11y.js";
import { AGENTUI_EVENT } from "../base/events.js";
import { DEFS_IDS } from "../styles/defs.js";
import type { TimelineData, TimelineItem } from "../types.js";

// ── Layout constants ──────────────────────────────────────────────────────────

const SPINE_X = 24;         // x center of the dot/spine column
const DOT_R = 6;            // dot radius
const ROW_H_EXPANDED = 56;  // row height in expanded density
const ROW_H_COMPACT = 32;   // row height in compact density
const PAD_TOP = 20;         // top padding before first item
const PAD_BOTTOM = 20;      // bottom padding after last item
const PAD_LEFT = SPINE_X + DOT_R + 12; // left edge of label text
const SVG_W = 400;          // fixed viewBox width

// ── Duration formatting ───────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export class ToolTimeline extends AgentUIElement<TimelineData> {
  private selectedId: string | null = null;

  // Override to add density, loading, error to the observed set.
  static override get observedAttributes(): string[] {
    return ["data", "density", "loading", "error"];
  }

  override attributeChangedCallback(
    name: string,
    old: string | null,
    value: string | null,
  ): void {
    // Let the base handle the "data" attribute.
    super.attributeChangedCallback(name, old, value);
    // For the other attributes, just schedule a re-render.
    if (name === "density" || name === "loading" || name === "error") {
      this.scheduleRender();
    }
  }

  protected componentCss(): string {
    return /* css */ `
      .tt-svg { width: 100%; min-height: 120px; }
      .tt-spine { stroke: var(--agentui-border); stroke-width: var(--agentui-stroke); }
      .tt-dot { fill: var(--status, var(--agentui-accent)); }
      .tt-dot-ring {
        fill: none;
        stroke: var(--agentui-selected-ring);
        stroke-width: var(--agentui-stroke-strong);
      }
      .tt-row[aria-selected="true"] .tt-dot-ring { display: block; }
      .tt-row:not([aria-selected="true"]) .tt-dot-ring { display: none; }
      .tt-label { font-weight: 600; fill: var(--agentui-fg); }
      .tt-detail { fill: var(--agentui-fg-muted); font-size: var(--agentui-font-size-sm); }
      .tt-chip-bg {
        fill: var(--agentui-surface-2);
        stroke: var(--agentui-border);
        stroke-width: 1;
        rx: 4;
      }
      .tt-chip-text { fill: var(--agentui-fg-muted); font-size: var(--agentui-font-size-sm); font-family: var(--agentui-font-mono); }
    `;
  }

  protected render(): void {
    this.resetScene();

    // ── Loading state ──────────────────────────────────────────────────────
    if (this.hasAttribute("loading")) {
      const div = document.createElement("div");
      div.className = "agentui-state";
      div.textContent = "Loading…";
      this.mount.append(div);
      return;
    }

    // ── Error state ────────────────────────────────────────────────────────
    const errorMsg = this.getAttribute("error");
    if (errorMsg !== null) {
      const div = document.createElement("div");
      div.className = "agentui-state";
      div.textContent = errorMsg || "An error occurred";
      this.mount.append(div);
      return;
    }

    // ── Empty state ────────────────────────────────────────────────────────
    const data = this.data;
    if (!data || data.items.length === 0) {
      this.renderEmpty();
      return;
    }

    const compact = this.getAttribute("density") === "compact";
    const rowH = compact ? ROW_H_COMPACT : ROW_H_EXPANDED;
    const items = data.items;
    const totalH = PAD_TOP + items.length * rowH + PAD_BOTTOM;

    const scene = createScene({
      width: SVG_W,
      height: totalH,
      label: "Tool call timeline",
      role: "group",
    });
    scene.svg.classList.add("tt-svg");

    // Spine line (from first dot center to last dot center).
    const spineY1 = PAD_TOP;
    const spineY2 = PAD_TOP + (items.length - 1) * rowH;
    if (items.length > 1) {
      scene.viewport.append(
        svg("line", {
          class: "tt-spine",
          x1: SPINE_X,
          y1: spineY1,
          x2: SPINE_X,
          y2: spineY2,
        }),
      );
    }

    // Rows.
    items.forEach((item, i) => {
      const rowEl = this.renderRow(item, i, rowH, compact);
      scene.viewport.append(rowEl);
    });

    this.mount.append(scene.svg);
  }

  private renderEmpty(): void {
    const div = document.createElement("div");
    div.className = "agentui-state";
    div.textContent = "No timeline yet";
    this.mount.append(div);
  }

  private renderRow(
    item: TimelineItem,
    index: number,
    rowH: number,
    compact: boolean,
  ): SVGGElement {
    const cy = PAD_TOP + index * rowH;
    const selected = item.id === this.selectedId;
    const status = item.status ?? "idle";

    const g = svg("g", {
      class: `tt-row status-${status}`,
      "data-item-id": item.id,
    });

    makeInteractive(g, {
      label: `${item.label}${item.status ? `, ${item.status}` : ""}${item.durationMs !== undefined ? `, ${formatDuration(item.durationMs)}` : ""}`,
      role: "button",
      selected,
    });

    // Glow filter for running items.
    if (status === "running") {
      g.setAttribute("filter", `url(#${DEFS_IDS.glow})`);
    }

    // Transparent full-row hit area so the whole row is clickable, not just the
    // painted glyphs (SVG hit-tests painted pixels only).
    g.append(
      svg("rect", {
        class: "tt-hit",
        x: 0,
        y: cy - rowH / 2,
        width: SVG_W,
        height: rowH,
        fill: "transparent",
      }),
    );

    // Dot + selection ring.
    g.append(
      svg("circle", { class: "tt-dot", cx: SPINE_X, cy, r: DOT_R }),
      svg("circle", { class: "tt-dot-ring", cx: SPINE_X, cy, r: DOT_R + 3 }),
    );

    // Label.
    const labelY = compact ? cy + 4 : cy - 8;
    g.append(
      svg("text", { class: "tt-label", x: PAD_LEFT, y: labelY + 5, "dominant-baseline": "middle" }, [
        truncate(item.label, 28),
      ]),
    );

    // Detail text (expanded only).
    if (!compact && item.detail) {
      g.append(
        svg("text", { class: "tt-detail", x: PAD_LEFT, y: labelY + 20, "dominant-baseline": "middle" }, [
          truncate(item.detail, 38),
        ]),
      );
    }

    // Duration chip.
    if (item.durationMs !== undefined) {
      const chipText = formatDuration(item.durationMs);
      const chipW = chipText.length * 7 + 10; // character-budget width, no DOM measurement
      const chipX = SVG_W - chipW - 12;
      const chipY = cy - 10;
      g.append(
        svg("rect", {
          class: "tt-chip-bg",
          x: chipX,
          y: chipY,
          width: chipW,
          height: 20,
          rx: 4,
        }),
        svg("text", {
          class: "tt-chip-text",
          x: chipX + chipW / 2,
          y: chipY + 10,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
        }, [chipText]),
      );
    }

    return g;
  }

  // ── Interaction ─────────────────────────────────────────────────────────────

  protected onActivate(el: Element): void {
    const row = el.closest("[data-item-id]");
    if (!row) return;
    const id = row.getAttribute("data-item-id")!;
    this.selectItem(id);
  }

  private selectItem(id: string): void {
    this.selectedId = id;
    const item = this.data?.items.find((i) => i.id === id);
    this.updateSelectionState();
    this.emit(AGENTUI_EVENT.select, { id, kind: "item" as const, data: item });
  }

  /** Update aria-selected in-place without a full re-render. */
  private updateSelectionState(): void {
    for (const g of this.mount.querySelectorAll<SVGGElement>("[data-item-id]")) {
      g.setAttribute(
        "aria-selected",
        String(g.getAttribute("data-item-id") === this.selectedId),
      );
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Programmatic selection by item id. Emits agentui:select. */
  public selectById(id: string): void {
    const item = this.data?.items.find((i) => i.id === id);
    if (item) this.selectItem(id);
  }

  /** Override resetScene to also clear the viewport ref (mirrors canvas pattern). */
  protected override resetScene(): void {
    clear(this.mount);
  }
}
