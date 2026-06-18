// ─── agentui-memory-map ──────────────────────────────────────────────────────
//
// Renders an agent's memory as a graph of typed nodes (preference, project,
// source, rule, output) connected by weighted links. Link strength (relevance,
// 0..1) drives stroke width + opacity. Nodes are colored + tagged by type. The
// selected node exposes inline ✎ edit and ✕ remove affordances that emit events
// only — the component never mutates its own data. An external "detail panel"
// can listen to `agentui:select` and read `detail.data` to show node details.
//
// Layout is fully data-driven and uses NO DOM measurement, so it is deterministic
// and renders identically under jsdom:
//   * "default" — a biased layered layout: `source` nodes on the left, `output`
//     nodes on the right, others in the middle column; stacked vertically.
//   * "grouped" — clusters nodes by their `group` key (falling back to `type`)
//     onto a grid of cluster centers, packing each cluster's nodes in a circle.
//
// Public API:
//   const el = document.createElement("agentui-memory-map");
//   el.data = { nodes: [...], links: [...] };
//   el.setAttribute("layout", "grouped");           // or "default"
//   el.addEventListener("agentui:select", (e) => e.detail);  // {id, kind, data}
//   el.addEventListener("agentui:edit",   (e) => e.detail);  // {id, data}
//   el.addEventListener("agentui:remove", (e) => e.detail);  // {id, data}
//
// Events: agentui:select (node | link), agentui:edit, agentui:remove,
//         agentui:action (background "clear").

import { AgentUIElement } from "../base/element.js";
import { svg, bezierPath, truncate, clear } from "../base/dom.js";
import { createScene } from "../base/scene.js";
import { makeInteractive } from "../base/a11y.js";
import { AGENTUI_EVENT } from "../base/events.js";
import { DEFS_IDS } from "../styles/defs.js";
import type { MemoryData, MemoryNode, MemoryLink, MemoryNodeType } from "../types.js";

const NODE_W = 132;
const NODE_H = 48;
const GAP_X = 110;
const GAP_Y = 28;
const PAD = 48;
const CLUSTER_GAP = 80;
const CLUSTER_RADIUS = 64;

/** Column index per node type for the default biased layout (left → right). */
const TYPE_COLUMN: Record<MemoryNodeType, number> = {
  source: 0,
  preference: 1,
  rule: 1,
  project: 1,
  output: 2,
};

/** Type → accent color variable (built on the token status palette + accent). */
const TYPE_COLOR: Record<MemoryNodeType, string> = {
  preference: "var(--agentui-status-planning)",
  project: "var(--agentui-accent)",
  source: "var(--agentui-status-running)",
  rule: "var(--agentui-status-waiting)",
  output: "var(--agentui-status-success)",
};

interface Placed extends MemoryNode {
  x: number;
  y: number;
}

export class MemoryMap extends AgentUIElement<MemoryData> {
  private selectedId: string | null = null;
  private transform = { x: 0, y: 0, k: 1 };
  private viewport: SVGGElement | null = null;
  private panning = false;
  private panStart = { x: 0, y: 0, tx: 0, ty: 0 };

  static get observedAttributes(): string[] {
    return ["data", "layout"];
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    super.attributeChangedCallback(name, old, value);
    if (name === "layout" && old !== value) this.scheduleRender();
  }

  protected componentCss(): string {
    return /* css */ `
      .mm-svg { width: 100%; height: 100%; min-height: 220px; touch-action: none; }
      .mm-node-bg {
        fill: var(--agentui-surface);
        stroke: var(--type, var(--agentui-border));
        stroke-width: var(--agentui-stroke);
        filter: url(#${DEFS_IDS.softShadow});
      }
      .mm-node[aria-selected="true"] .mm-node-bg {
        stroke: var(--agentui-selected-ring);
        stroke-width: var(--agentui-stroke-strong);
      }
      .mm-node-accent { fill: var(--type, var(--agentui-accent)); }
      .mm-label { font-weight: 600; fill: var(--agentui-fg); }
      .mm-type-tag {
        fill: var(--type, var(--agentui-accent));
        font-size: var(--agentui-font-size-sm);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .mm-link { fill: none; stroke: var(--agentui-fg-muted); }
      .mm-link[aria-selected="true"] { stroke: var(--agentui-selected-ring); }
      .mm-link-hit { fill: none; stroke: transparent; stroke-width: 14; }
      .mm-affordance-bg {
        fill: var(--agentui-surface-2);
        stroke: var(--agentui-border);
        stroke-width: var(--agentui-stroke);
      }
      .mm-affordance-glyph {
        fill: var(--agentui-fg);
        font-size: 13px;
        text-anchor: middle;
        dominant-baseline: central;
      }
      .mm-affordance[aria-label*="Remove"] .mm-affordance-glyph { fill: var(--agentui-status-failed); }
    `;
  }

  protected render(): void {
    this.resetScene();
    const data = this.data;
    if (!data || data.nodes.length === 0) {
      this.renderEmpty();
      return;
    }

    const placed = this.layout(data.nodes);
    const extent = this.extent(placed);
    const scene = createScene({
      width: extent.w,
      height: extent.h,
      label: "Agent memory map",
      role: "group",
    });
    scene.svg.classList.add("mm-svg");
    this.viewport = scene.viewport;
    this.applyTransform();

    // Links first (under nodes).
    const byId = new Map(placed.map((n) => [n.id, n]));
    for (const link of data.links ?? []) {
      const g = this.renderLink(link, byId);
      if (g) scene.viewport.append(g);
    }
    for (const node of placed) {
      scene.viewport.append(this.renderNode(node));
    }

    this.mount.append(scene.svg);
    this.wirePanZoom(scene.svg);
  }

  private renderEmpty(): void {
    const div = document.createElement("div");
    div.className = "agentui-state";
    div.textContent = "No memory to display";
    this.mount.append(div);
  }

  // ── Layout ───────────────────────────────────────────────────────────────--

  private layout(nodes: MemoryNode[]): Placed[] {
    return this.layoutMode() === "grouped"
      ? this.layoutGrouped(nodes)
      : this.layoutDefault(nodes);
  }

  private layoutMode(): "default" | "grouped" {
    return this.getAttribute("layout") === "grouped" ? "grouped" : "default";
  }

  /**
   * Biased layered layout: place each node in a column derived from its type
   * (sources left, outputs right, others in the middle) and stack vertically
   * within the column by appearance order. Explicit x/y on a node win.
   */
  private layoutDefault(nodes: MemoryNode[]): Placed[] {
    const rowInCol = new Map<number, number>();
    return nodes.map((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        return { ...n, x: n.x, y: n.y };
      }
      const col = TYPE_COLUMN[n.type] ?? 1;
      const row = rowInCol.get(col) ?? 0;
      rowInCol.set(col, row + 1);
      return {
        ...n,
        x: n.x ?? PAD + col * (NODE_W + GAP_X),
        y: n.y ?? PAD + row * (NODE_H + GAP_Y),
      };
    });
  }

  /**
   * Clustered layout: bucket nodes by `group` (falling back to `type`), lay the
   * clusters out on a square grid, then pack each cluster's nodes around its
   * center on a circle. Deterministic (Math.cos/sin by index — no randomness).
   */
  private layoutGrouped(nodes: MemoryNode[]): Placed[] {
    const clusters = new Map<string, MemoryNode[]>();
    for (const n of nodes) {
      const key = n.group ?? n.type;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key)!.push(n);
    }
    const keys = [...clusters.keys()];
    const cols = Math.max(1, Math.ceil(Math.sqrt(keys.length)));
    const cellW = CLUSTER_RADIUS * 2 + NODE_W + CLUSTER_GAP;
    const cellH = CLUSTER_RADIUS * 2 + NODE_H + CLUSTER_GAP;
    const placed: Placed[] = [];
    keys.forEach((key, ci) => {
      const group = clusters.get(key)!;
      const cx = PAD + (ci % cols) * cellW + cellW / 2;
      const cy = PAD + Math.floor(ci / cols) * cellH + cellH / 2;
      const count = group.length;
      group.forEach((n, i) => {
        if (n.x !== undefined && n.y !== undefined) {
          placed.push({ ...n, x: n.x, y: n.y });
          return;
        }
        // Single node sits at the center; otherwise pack on a circle.
        const angle = count === 1 ? 0 : (i / count) * Math.PI * 2;
        const r = count === 1 ? 0 : CLUSTER_RADIUS;
        placed.push({
          ...n,
          x: cx + Math.cos(angle) * r - NODE_W / 2,
          y: cy + Math.sin(angle) * r - NODE_H / 2,
        });
      });
    });
    return placed;
  }

  private extent(placed: Placed[]): { w: number; h: number } {
    let maxX = 0;
    let maxY = 0;
    for (const n of placed) {
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    }
    return { w: maxX + PAD, h: maxY + PAD };
  }

  // ── Node / link rendering ──────────────────────────────────────────────────

  private renderNode(node: Placed): SVGGElement {
    const selected = node.id === this.selectedId;
    const g = svg("g", {
      class: `mm-node type-${node.type}`,
      transform: `translate(${node.x} ${node.y})`,
      "data-node-id": node.id,
      "data-type": node.type,
      style: `--type: ${TYPE_COLOR[node.type] ?? "var(--agentui-accent)"};`,
    });
    makeInteractive(g, {
      label: `${node.label}, ${node.type}`,
      role: "button",
      selected,
    });
    g.append(
      svg("rect", { class: "mm-node-bg", width: NODE_W, height: NODE_H, rx: 10 }),
      svg("rect", { class: "mm-node-accent", x: 0, y: 0, width: 4, height: NODE_H, rx: 2 }),
      svg("text", { class: "mm-type-tag", x: 16, y: 18 }, [node.type]),
      svg("text", { class: "mm-label", x: 16, y: 36 }, [truncate(node.label, 16)]),
    );
    if (selected) {
      g.append(this.renderAffordances(node));
    }
    return g;
  }

  /** Inline ✎ edit + ✕ remove buttons rendered on the selected node. */
  private renderAffordances(node: Placed): SVGGElement {
    const group = svg("g", { class: "mm-affordances" });
    const make = (
      cls: "edit" | "remove",
      glyph: string,
      label: string,
      cx: number,
    ): SVGGElement => {
      const btn = svg("g", {
        class: "mm-affordance",
        transform: `translate(${cx} -12)`,
        "data-affordance": cls,
      });
      makeInteractive(btn, { label, role: "button" });
      btn.append(
        svg("rect", { class: "mm-affordance-bg", width: 22, height: 22, rx: 6 }),
        svg("text", { class: "mm-affordance-glyph", x: 11, y: 11 }, [glyph]),
      );
      return btn;
    };
    group.append(
      make("edit", "✎", `Edit ${node.label}`, NODE_W - 50),
      make("remove", "✕", `Remove ${node.label}`, NODE_W - 24),
    );
    return group;
  }

  private renderLink(link: MemoryLink, byId: Map<string, Placed>): SVGGElement | null {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) return null;
    const x1 = from.x + NODE_W / 2;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x + NODE_W / 2;
    const y2 = to.y + NODE_H / 2;
    const d = bezierPath(x1, y1, x2, y2);
    const selected = link.id === this.selectedId;
    // Strength (0..1) drives weight + opacity; stronger = thicker + more opaque.
    const strength = clamp01(link.strength ?? 0.5);
    const width = 1 + strength * 4;
    const opacity = 0.25 + strength * 0.65;
    const g = svg("g", { class: "mm-link-group", "data-link-id": link.id });
    const visible = svg("path", {
      class: "mm-link",
      d,
      "stroke-width": width,
      "stroke-opacity": opacity,
      "aria-selected": String(selected),
    });
    const hit = svg("path", { class: "mm-link-hit", d });
    makeInteractive(hit, {
      label: `Link from ${from.label} to ${to.label}, relevance ${strength.toFixed(2)}`,
      role: "button",
      selected,
    });
    g.append(visible, hit);
    return g;
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  protected onActivate(el: Element): void {
    const affordance = el.closest("[data-affordance]");
    if (affordance) {
      const nodeG = affordance.closest("[data-node-id]");
      const id = nodeG?.getAttribute("data-node-id");
      if (id) {
        const data = this.data?.nodes.find((n) => n.id === id);
        const kind = affordance.getAttribute("data-affordance");
        this.emit(kind === "remove" ? AGENTUI_EVENT.remove : AGENTUI_EVENT.edit, { id, data });
      }
      return;
    }
    const nodeG = el.closest("[data-node-id]");
    if (nodeG) {
      this.select(nodeG.getAttribute("data-node-id")!, "node");
      return;
    }
    const linkHit = el.closest("[data-link-id]") ?? el.parentElement?.closest("[data-link-id]");
    if (linkHit) {
      this.select(linkHit.getAttribute("data-link-id")!, "link");
    }
  }

  private select(id: string, kind: "node" | "link"): void {
    this.selectedId = id;
    const data =
      kind === "node"
        ? this.data?.nodes.find((n) => n.id === id)
        : this.data?.links?.find((l) => l.id === id);
    // A node's affordances appear only when selected, so re-render on node
    // selection; link selection only needs an in-place attribute update.
    if (kind === "node") {
      this.render();
    } else {
      this.updateSelectionState();
    }
    this.emit(AGENTUI_EVENT.select, { id, kind, data });
  }

  /** Update aria-selected + selection styling without a full re-render. */
  private updateSelectionState(): void {
    for (const g of this.mount.querySelectorAll<SVGGElement>("[data-node-id]")) {
      g.setAttribute("aria-selected", String(g.getAttribute("data-node-id") === this.selectedId));
    }
    for (const g of this.mount.querySelectorAll<SVGGElement>("[data-link-id]")) {
      const on = g.getAttribute("data-link-id") === this.selectedId;
      g.querySelector(".mm-link")?.setAttribute("aria-selected", String(on));
      g.querySelector("[data-activate]")?.setAttribute("aria-selected", String(on));
    }
  }

  // ── Pan / zoom ─────────────────────────────────────────────────────────────

  private applyTransform(): void {
    if (!this.viewport) return;
    const { x, y, k } = this.transform;
    this.viewport.setAttribute("transform", `translate(${x} ${y}) scale(${k})`);
  }

  private wirePanZoom(root: SVGSVGElement): void {
    root.addEventListener("pointerdown", (e) => {
      // Only pan when the background (not an interactive part) is grabbed.
      const target = e.target as Element;
      if (target.closest("[data-activate]")) return;
      this.panning = true;
      this.panStart = { x: e.clientX, y: e.clientY, tx: this.transform.x, ty: this.transform.y };
      root.setPointerCapture?.(e.pointerId);
      // Background click clears selection.
      if (this.selectedId !== null) {
        this.selectedId = null;
        this.render();
        this.emit(AGENTUI_EVENT.action, { action: "clear" });
      }
    });
    root.addEventListener("pointermove", (e) => {
      if (!this.panning) return;
      this.transform.x = this.panStart.tx + (e.clientX - this.panStart.x);
      this.transform.y = this.panStart.ty + (e.clientY - this.panStart.y);
      this.applyTransform();
    });
    const end = (e: PointerEvent): void => {
      this.panning = false;
      root.releasePointerCapture?.(e.pointerId);
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
    root.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.transform.k = Math.min(3, Math.max(0.3, this.transform.k * factor));
        this.applyTransform();
      },
      { passive: false },
    );
  }

  /** Programmatic API: reset pan/zoom to the identity transform. */
  public resetView(): void {
    this.transform = { x: 0, y: 0, k: 1 };
    this.applyTransform();
  }

  /** Programmatic API: select a node/link by id (also emits agentui:select). */
  public selectById(id: string): void {
    const node = this.data?.nodes.find((n) => n.id === id);
    if (node) return this.select(id, "node");
    const link = this.data?.links?.find((l) => l.id === id);
    if (link) this.select(id, "link");
  }

  protected resetScene(): void {
    clear(this.mount);
    this.viewport = null;
  }
}

/** Clamp a number into the [0, 1] range. */
function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
