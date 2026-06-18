// ─── agentui-workflow-canvas ─────────────────────────────────────────────────
//
// Renders an agent flow as nodes + edges with pan/zoom, selection, and status
// styling. Layout: explicit x/y on a node is respected; otherwise nodes are
// auto-placed in a left-to-right layered layout derived from edge direction.
//
// Public API:
//   const el = document.createElement("agentui-workflow-canvas");
//   el.data = { nodes: [...], edges: [...] };
//   el.addEventListener("agentui:select", (e) => e.detail);  // {id, kind, data}
//   el.addEventListener("agentui:action", (e) => e.detail);
//
// Events: agentui:select (node | edge), agentui:action (background "clear").

import { AgentUIElement } from "../base/element.js";
import { svg, bezierPath, truncate, clear } from "../base/dom.js";
import { createScene } from "../base/scene.js";
import { makeInteractive } from "../base/a11y.js";
import { AGENTUI_EVENT } from "../base/events.js";
import { statusColorVar } from "../styles/tokens.js";
import { DEFS_IDS } from "../styles/defs.js";
import type { WorkflowData, WorkflowNode, WorkflowEdge } from "../types.js";

const NODE_W = 150;
const NODE_H = 56;
const GAP_X = 90;
const GAP_Y = 32;
const PAD = 40;

interface Placed extends WorkflowNode {
  x: number;
  y: number;
}

export class WorkflowCanvas extends AgentUIElement<WorkflowData> {
  private selectedId: string | null = null;
  private transform = { x: 0, y: 0, k: 1 };
  private viewport: SVGGElement | null = null;
  private panning = false;
  private panStart = { x: 0, y: 0, tx: 0, ty: 0 };

  protected componentCss(): string {
    return /* css */ `
      .wc-svg { width: 100%; height: 100%; min-height: 220px; touch-action: none; }
      .wc-node-bg {
        fill: var(--agentui-surface);
        stroke: var(--status, var(--agentui-border));
        stroke-width: var(--agentui-stroke);
        rx: var(--agentui-radius);
        filter: url(#${DEFS_IDS.softShadow});
      }
      .wc-node[aria-selected="true"] .wc-node-bg {
        stroke: var(--agentui-selected-ring);
        stroke-width: var(--agentui-stroke-strong);
      }
      .wc-node-accent { fill: var(--status, var(--agentui-accent)); }
      .wc-label { font-weight: 600; fill: var(--agentui-fg); }
      .wc-sublabel { fill: var(--agentui-fg-muted); font-size: var(--agentui-font-size-sm); }
      .wc-edge { fill: none; stroke: var(--status, var(--agentui-border)); stroke-width: var(--agentui-stroke); }
      .wc-edge[aria-selected="true"] { stroke: var(--agentui-selected-ring); stroke-width: var(--agentui-stroke-strong); }
      .wc-edge-hit { fill: none; stroke: transparent; stroke-width: 14; }
      .wc-edge-label { fill: var(--agentui-fg-muted); font-size: var(--agentui-font-size-sm); }
    `;
  }

  protected render(): void {
    this.resetScene();
    const data = this.data;
    if (!data || data.nodes.length === 0) {
      this.renderEmpty();
      return;
    }

    const placed = this.layout(data.nodes, data.edges ?? []);
    const extent = this.extent(placed);
    const scene = createScene({
      width: extent.w,
      height: extent.h,
      label: "Agent workflow canvas",
      role: "group",
    });
    scene.svg.classList.add("wc-svg");
    this.viewport = scene.viewport;
    this.applyTransform();

    // Edges first (under nodes).
    const byId = new Map(placed.map((n) => [n.id, n]));
    for (const edge of data.edges ?? []) {
      const g = this.renderEdge(edge, byId);
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
    div.textContent = "No workflow to display";
    this.mount.append(div);
  }

  // ── Layout ───────────────────────────────────────────────────────────────--

  private layout(nodes: WorkflowNode[], edges: WorkflowEdge[]): Placed[] {
    const needsAuto = nodes.some((n) => n.x === undefined || n.y === undefined);
    if (!needsAuto) {
      return nodes.map((n) => ({ ...n, x: n.x as number, y: n.y as number }));
    }

    // Layered layout: layer = longest path from a root (no incoming edge).
    const incoming = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of nodes) {
      incoming.set(n.id, 0);
      adj.set(n.id, []);
    }
    for (const e of edges) {
      if (!incoming.has(e.to) || !adj.has(e.from)) continue;
      incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
      adj.get(e.from)!.push(e.to);
    }
    const layer = new Map<string, number>();
    const queue: string[] = [];
    for (const n of nodes) {
      if ((incoming.get(n.id) ?? 0) === 0) {
        layer.set(n.id, 0);
        queue.push(n.id);
      }
    }
    // Fallback: if every node has an incoming edge (cycle), seed the first node.
    if (queue.length === 0 && nodes.length > 0) {
      layer.set(nodes[0]!.id, 0);
      queue.push(nodes[0]!.id);
    }
    const remaining = new Map(incoming);
    while (queue.length) {
      const id = queue.shift()!;
      const l = layer.get(id) ?? 0;
      for (const next of adj.get(id) ?? []) {
        layer.set(next, Math.max(layer.get(next) ?? 0, l + 1));
        remaining.set(next, (remaining.get(next) ?? 1) - 1);
        if ((remaining.get(next) ?? 0) <= 0) queue.push(next);
      }
    }

    // Group by layer, then stack vertically within each layer.
    const layers = new Map<number, WorkflowNode[]>();
    for (const n of nodes) {
      const l = layer.get(n.id) ?? 0;
      if (!layers.has(l)) layers.set(l, []);
      layers.get(l)!.push(n);
    }
    const placed: Placed[] = [];
    for (const [l, group] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
      group.forEach((n, i) => {
        placed.push({
          ...n,
          x: n.x ?? PAD + l * (NODE_W + GAP_X),
          y: n.y ?? PAD + i * (NODE_H + GAP_Y),
        });
      });
    }
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

  // ── Node / edge rendering ──────────────────────────────────────────────────

  private renderNode(node: Placed): SVGGElement {
    const selected = node.id === this.selectedId;
    const g = svg("g", {
      class: `wc-node status-${node.status ?? "idle"}`,
      transform: `translate(${node.x} ${node.y})`,
      "data-node-id": node.id,
    });
    makeInteractive(g, {
      label: `${node.label}${node.status ? `, ${node.status}` : ""}`,
      role: "button",
      selected,
    });
    if (node.status === "running") {
      g.setAttribute("filter", `url(#${DEFS_IDS.glow})`);
    }
    g.append(
      svg("rect", { class: "wc-node-bg", width: NODE_W, height: NODE_H, rx: 10 }),
      svg("rect", { class: "wc-node-accent", x: 0, y: 0, width: 4, height: NODE_H, rx: 2 }),
      svg("text", { class: "wc-label", x: 16, y: node.sublabel ? 24 : 32 }, [
        truncate(node.label, 18),
      ]),
    );
    if (node.sublabel) {
      g.append(
        svg("text", { class: "wc-sublabel", x: 16, y: 42 }, [truncate(node.sublabel, 22)]),
      );
    }
    return g;
  }

  private renderEdge(edge: WorkflowEdge, byId: Map<string, Placed>): SVGGElement | null {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return null;
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const d = bezierPath(x1, y1, x2, y2);
    const selected = edge.id === this.selectedId;
    const g = svg("g", {
      class: `wc-edge-group status-${edge.status ?? "idle"}`,
      "data-edge-id": edge.id,
    });
    const visible = svg("path", { class: "wc-edge", d, "aria-selected": String(selected) });
    const hit = svg("path", { class: "wc-edge-hit", d });
    makeInteractive(hit, {
      label: `Edge from ${from.label} to ${to.label}`,
      role: "button",
      selected,
    });
    g.append(visible, hit);
    if (edge.label) {
      g.append(
        svg("text", { class: "wc-edge-label", x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6, "text-anchor": "middle" }, [
          truncate(edge.label, 16),
        ]),
      );
    }
    return g;
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  protected onActivate(el: Element): void {
    const nodeG = el.closest("[data-node-id]");
    if (nodeG) {
      const id = nodeG.getAttribute("data-node-id")!;
      this.select(id, "node");
      return;
    }
    const edgeHit = el.closest("[data-edge-id]") ?? el.parentElement?.closest("[data-edge-id]");
    if (edgeHit) {
      const id = edgeHit.getAttribute("data-edge-id")!;
      this.select(id, "edge");
    }
  }

  private select(id: string, kind: "node" | "edge"): void {
    this.selectedId = id;
    const data =
      kind === "node"
        ? this.data?.nodes.find((n) => n.id === id)
        : this.data?.edges?.find((e) => e.id === id);
    this.updateSelectionState();
    this.emit(AGENTUI_EVENT.select, { id, kind, data });
  }

  /** Update aria-selected + selection styling without a full re-render. */
  private updateSelectionState(): void {
    for (const g of this.mount.querySelectorAll<SVGGElement>("[data-node-id]")) {
      g.setAttribute("aria-selected", String(g.getAttribute("data-node-id") === this.selectedId));
    }
    for (const g of this.mount.querySelectorAll<SVGGElement>("[data-edge-id]")) {
      const on = g.getAttribute("data-edge-id") === this.selectedId;
      const path = g.querySelector(".wc-edge");
      path?.setAttribute("aria-selected", String(on));
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
        this.updateSelectionState();
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

  /** Programmatic API: select a node/edge by id (no event side effects beyond emit). */
  public selectById(id: string): void {
    const node = this.data?.nodes.find((n) => n.id === id);
    if (node) return this.select(id, "node");
    const edge = this.data?.edges?.find((e) => e.id === id);
    if (edge) this.select(id, "edge");
  }

  protected resetScene(): void {
    clear(this.mount);
    this.viewport = null;
  }
}
