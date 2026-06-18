// ─── agentui-state-machine ───────────────────────────────────────────────────
//
// Renders an agent's finite-state machine as state nodes + directed transitions.
// One state is "active" (`data.active`) and is emphasised with an accent border,
// a glow filter, and `aria-current="true"`. States carry an optional status that
// drives their accent color (success / waiting / failed / skipped, plus the
// process states idle / planning / running).
//
// Layout is deterministic and data-driven (no DOM measurement), selectable via a
// `layout` attribute:
//   * horizontal — states laid out left-to-right in array order, vertically centered.
//   * radial     — states placed on a circle by index (Math.cos/sin), no randomness.
//
// Public API:
//   const el = document.createElement("agentui-state-machine");
//   el.setAttribute("layout", "horizontal"); // or "radial"
//   el.data = { states: [...], transitions: [...], active: "running" };
//   el.addEventListener("agentui:select", (e) => e.detail); // {id, kind:"state", data}
//   el.setActive("done");      // move the active marker + re-render
//   el.selectById("planning"); // programmatic selection
//
// Events: agentui:select (kind "state").

import { AgentUIElement } from "../base/element.js";
import { svg, truncate, linePath, clear } from "../base/dom.js";
import { createScene } from "../base/scene.js";
import { makeInteractive } from "../base/a11y.js";
import { AGENTUI_EVENT } from "../base/events.js";
import { DEFS_IDS } from "../styles/defs.js";
import type { MachineData, MachineState, MachineTransition } from "../types.js";

type Layout = "horizontal" | "radial";

const NODE_W = 132;
const NODE_H = 48;
const GAP_X = 72;
const PAD = 48;
const RADIAL_GAP = 56;
const ARROW_ID = "agentui-sm-arrow";

interface Placed extends MachineState {
  /** Center x of the state node. */
  cx: number;
  /** Center y of the state node. */
  cy: number;
}

export class StateMachine extends AgentUIElement<MachineData> {
  private selectedId: string | null = null;

  static get observedAttributes(): string[] {
    return ["data", "layout"];
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "layout") {
      this.scheduleRender();
      return;
    }
    super.attributeChangedCallback(name, _old, value);
  }

  private get layout(): Layout {
    return this.getAttribute("layout") === "radial" ? "radial" : "horizontal";
  }

  protected componentCss(): string {
    return /* css */ `
      .sm-svg { width: 100%; height: 100%; min-height: 200px; }
      .sm-node-bg {
        fill: var(--agentui-surface);
        stroke: var(--status, var(--agentui-border));
        stroke-width: var(--agentui-stroke);
        filter: url(#${DEFS_IDS.softShadow});
      }
      .sm-node[aria-current="true"] .sm-node-bg {
        stroke: var(--agentui-accent);
        stroke-width: var(--agentui-stroke-strong);
      }
      .sm-node[aria-selected="true"] .sm-node-bg {
        stroke: var(--agentui-selected-ring);
        stroke-width: var(--agentui-stroke-strong);
      }
      .sm-node-dot { fill: var(--status, var(--agentui-accent)); }
      .sm-label { font-weight: 600; fill: var(--agentui-fg); text-anchor: middle; }
      .sm-edge { fill: none; stroke: var(--agentui-border); stroke-width: var(--agentui-stroke); }
      .sm-arrow { fill: var(--agentui-border); }
      .sm-edge-label { fill: var(--agentui-fg-muted); font-size: var(--agentui-font-size-sm); text-anchor: middle; }
    `;
  }

  protected render(): void {
    this.resetScene();
    const data = this.data;
    if (!data || data.states.length === 0) {
      this.renderEmpty();
      return;
    }

    const placed = this.placeStates(data.states);
    const extent = this.extent(placed);
    const scene = createScene({
      width: extent.w,
      height: extent.h,
      label: "Agent state machine",
      role: "group",
    });
    scene.svg.classList.add("sm-svg");
    scene.defs.append(this.buildArrowMarker());

    const byId = new Map(placed.map((s) => [s.id, s]));
    // Transitions first (under nodes).
    for (const t of data.transitions ?? []) {
      const g = this.renderTransition(t, byId);
      if (g) scene.viewport.append(g);
    }
    for (const state of placed) {
      scene.viewport.append(this.renderState(state, data.active));
    }

    this.mount.append(scene.svg);
  }

  private renderEmpty(): void {
    const div = document.createElement("div");
    div.className = "agentui-state";
    div.textContent = "No states to display";
    this.mount.append(div);
  }

  // ── Layout ───────────────────────────────────────────────────────────────--

  private placeStates(states: MachineState[]): Placed[] {
    return this.layout === "radial"
      ? this.placeRadial(states)
      : this.placeHorizontal(states);
  }

  private placeHorizontal(states: MachineState[]): Placed[] {
    const cy = PAD + NODE_H / 2;
    return states.map((s, i) => ({
      ...s,
      cx: PAD + NODE_W / 2 + i * (NODE_W + GAP_X),
      cy,
    }));
  }

  private placeRadial(states: MachineState[]): Placed[] {
    const count = states.length;
    // Radius grows with node count so neighbours don't overlap.
    const radius = Math.max(
      NODE_W,
      (count * (NODE_W + RADIAL_GAP)) / (2 * Math.PI),
    );
    const center = PAD + NODE_W / 2 + radius;
    return states.map((s, i) => {
      // Start at the top (−90°) and go clockwise.
      const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
      return {
        ...s,
        cx: center + radius * Math.cos(angle),
        cy: center + radius * Math.sin(angle),
      };
    });
  }

  private extent(placed: Placed[]): { w: number; h: number } {
    let maxX = 0;
    let maxY = 0;
    for (const s of placed) {
      maxX = Math.max(maxX, s.cx + NODE_W / 2);
      maxY = Math.max(maxY, s.cy + NODE_H / 2);
    }
    return { w: maxX + PAD, h: maxY + PAD };
  }

  // ── Node / transition rendering ────────────────────────────────────────────

  private renderState(state: Placed, active: string | undefined): SVGGElement {
    const selected = state.id === this.selectedId;
    const isActive = state.id === active;
    const x = state.cx - NODE_W / 2;
    const y = state.cy - NODE_H / 2;
    const g = svg("g", {
      class: `sm-node status-${state.status ?? "idle"}`,
      transform: `translate(${x} ${y})`,
      "data-state-id": state.id,
    });
    makeInteractive(g, {
      label: `${state.label}${state.status ? `, ${state.status}` : ""}${isActive ? ", active" : ""}`,
      role: "button",
      selected,
    });
    if (isActive) {
      g.setAttribute("aria-current", "true");
      g.setAttribute("filter", `url(#${DEFS_IDS.glow})`);
    }
    g.append(
      svg("rect", {
        class: "sm-node-bg",
        width: NODE_W,
        height: NODE_H,
        rx: NODE_H / 2,
      }),
      svg("circle", { class: "sm-node-dot", cx: 18, cy: NODE_H / 2, r: 5 }),
      svg("text", { class: "sm-label", x: NODE_W / 2 + 6, y: NODE_H / 2 + 4 }, [
        truncate(state.label, 14),
      ]),
    );
    return g;
  }

  private renderTransition(
    t: MachineTransition,
    byId: Map<string, Placed>,
  ): SVGGElement | null {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (!from || !to) return null;
    // Trim the line to the node edges so the arrowhead sits at the border.
    const [x1, y1] = this.edgePoint(from, to);
    const [x2, y2] = this.edgePoint(to, from);
    const g = svg("g", { class: "sm-edge-group", "data-transition-id": t.id });
    g.append(
      svg("path", {
        class: "sm-edge",
        d: linePath(x1, y1, x2, y2),
        "marker-end": `url(#${ARROW_ID})`,
      }),
    );
    if (t.label) {
      g.append(
        svg(
          "text",
          { class: "sm-edge-label", x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6 },
          [truncate(t.label, 16)],
        ),
      );
    }
    return g;
  }

  /**
   * Point on `from`'s node boundary along the ray toward `to`. Treats the node
   * as a rectangle and clips the center→center ray to its half-extents, leaving
   * a small margin so the arrowhead doesn't overlap the stroke.
   */
  private edgePoint(from: Placed, to: Placed): [number, number] {
    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    if (dx === 0 && dy === 0) return [from.cx, from.cy];
    const halfW = NODE_W / 2 + 4;
    const halfH = NODE_H / 2 + 4;
    const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
    return [from.cx + dx * scale, from.cy + dy * scale];
  }

  /** Local arrowhead marker, appended to this scene's <defs> (not the shared ones). */
  private buildArrowMarker(): SVGMarkerElement {
    const marker = svg("marker", {
      id: ARROW_ID,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto-start-reverse",
    });
    marker.append(svg("path", { class: "sm-arrow", d: "M 0 0 L 10 5 L 0 10 z" }));
    return marker as SVGMarkerElement;
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  protected onActivate(el: Element): void {
    const stateG = el.closest("[data-state-id]");
    if (stateG) {
      this.select(stateG.getAttribute("data-state-id")!);
    }
  }

  private select(id: string): void {
    this.selectedId = id;
    const data = this.data?.states.find((s) => s.id === id);
    this.updateSelectionState();
    this.emit(AGENTUI_EVENT.select, { id, kind: "state", data });
  }

  /** Update aria-selected styling without a full re-render. */
  private updateSelectionState(): void {
    for (const g of this.mount.querySelectorAll<SVGGElement>("[data-state-id]")) {
      g.setAttribute(
        "aria-selected",
        String(g.getAttribute("data-state-id") === this.selectedId),
      );
    }
  }

  // ── Programmatic API ───────────────────────────────────────────────────────

  /** Select a state by id (mirrors a user click; emits agentui:select). */
  public selectById(id: string): void {
    if (this.data?.states.some((s) => s.id === id)) this.select(id);
  }

  /** Set the active state and re-render so the active marker moves. */
  public setActive(id: string): void {
    if (!this.data) return;
    this.data = { ...this.data, active: id };
  }

  protected resetScene(): void {
    clear(this.mount);
  }
}
