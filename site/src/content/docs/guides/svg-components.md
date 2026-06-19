---
title: "SVG Agent UI components"
description: "SVG-native Web Components for visualizing agent workflows, tool-call timelines, approval gates, memory maps, and state machines. Framework-agnostic custom elements from @kibadist/agentui-svg."
---

`@kibadist/agentui-svg` is a **zero-dependency, framework-agnostic** set of
SVG-native [Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components)
that make agent behavior visible, interactive, and controllable. They are custom
elements — use them in plain HTML, React, Vue, Svelte, or anywhere the DOM
exists. They share none of the React runtime, so you can adopt them next to (or
without) the rest of AgentUI.

```bash
npm i @kibadist/agentui-svg
```

```js
import "@kibadist/agentui-svg/register"; // registers every <agentui-*> element
```

## Why SVG for agent interfaces?

Agent products are no longer simple CRUD screens. They need **visual, spatial**
interfaces for things that have shape and relationship:

- a **workflow** is a graph of nodes and edges, not a list;
- a **tool run** is an ordered timeline with status and duration;
- **memory/context** is a weighted graph feeding an output;
- a **state machine** has a current state and transitions;
- an **approval checkpoint** is a focal decision moment.

SVG gives scalable, crisp vector scenes that style with CSS, hit-test for
interaction, and support filters/gradients/masks for depth and emphasis — all
without a canvas redraw loop or a charting dependency. HTML stays available for
the parts SVG is bad at (forms, long editable text), projected via overlays and
slots.

## The five components

| Use case | Element | Emits |
| --- | --- | --- |
| **Agent Workflow Canvas** — see the flow | `agentui-workflow-canvas` | `agentui:select`, `agentui:action` |
| **Tool Call Timeline** — see the run | `agentui-tool-timeline` | `agentui:select` |
| **Human Approval Gate** — control the flow | `agentui-review-checkpoint` | `agentui:decision` |
| **Agent Memory Map** — see the context | `agentui-memory-map` | `agentui:select`, `agentui:edit`, `agentui:remove` |
| **Agent State Machine Viewer** — see the state | `agentui-state-machine` | `agentui:select` |

Every event **bubbles** and is **composed**, so one listener on the element (or
any ancestor) receives it, and every `detail` is plain and serializable.

### Workflow canvas

```js
const canvas = document.createElement("agentui-workflow-canvas");
canvas.data = {
  nodes: [
    { id: "plan", label: "Planner", status: "success" },
    { id: "tool", label: "Search", sublabel: "web.search", status: "running" },
    { id: "mem",  label: "Memory", status: "idle" },
    { id: "resp", label: "Response", status: "waiting" },
  ],
  edges: [
    { id: "e1", from: "plan", to: "tool" },
    { id: "e2", from: "tool", to: "mem", label: "store" },
    { id: "e3", from: "mem",  to: "resp" },
  ],
};
canvas.addEventListener("agentui:select", (e) => console.log(e.detail)); // { id, kind, data }
document.body.append(canvas);
```

Nodes auto-lay-out left-to-right by edge direction when you omit `x`/`y`. Pan by
dragging the background; zoom with the wheel.

### Tool call timeline

```js
const timeline = document.createElement("agentui-tool-timeline");
timeline.setAttribute("density", "expanded"); // or "compact"
timeline.data = { items: [
  { id: "1", label: "plan",       status: "success", durationMs: 120 },
  { id: "2", label: "web.search", status: "success", durationMs: 820, detail: "3 results" },
  { id: "3", label: "db.query",   status: "failed",  durationMs: 40 },
] };
timeline.addEventListener("agentui:select", (e) => console.log(e.detail.id));
```

### Human approval gate

```js
const gate = document.createElement("agentui-review-checkpoint");
gate.data = {
  title: "Send 1,204 emails?",
  description: "Campaign sends immediately and cannot be recalled.",
  level: "high",                       // low | medium | high
  summary: "1,204 recipients · launch-v2",
};
gate.addEventListener("agentui:decision", (e) => {
  console.log(e.detail.action, e.detail.note); // "continue" | "stop" | "revise"
});
```

The buttons and the optional note are real HTML controls (keyboard-accessible) —
SVG is reserved for the level emblem. Project preview content with the `preview`
slot.

### Memory map

```js
const memory = document.createElement("agentui-memory-map");
memory.setAttribute("layout", "grouped"); // or "default"
memory.data = {
  nodes: [
    { id: "p1", label: "Tone: concise", type: "preference" },
    { id: "s1", label: "spec.md",       type: "source" },
    { id: "out", label: "Draft reply",  type: "output" },
  ],
  links: [
    { id: "l1", from: "p1", to: "out", strength: 0.6 },
    { id: "l2", from: "s1", to: "out", strength: 0.9 },
  ],
};
memory.addEventListener("agentui:remove", (e) => console.log("remove", e.detail.id));
```

Link `strength` (0–1) drives stroke weight and opacity. Edit/remove affordances
emit events only — the component never mutates your data.

### State machine viewer

```js
const machine = document.createElement("agentui-state-machine");
machine.setAttribute("layout", "horizontal"); // or "radial"
machine.data = {
  states: [
    { id: "idle",     label: "Idle" },
    { id: "planning", label: "Planning" },
    { id: "running",  label: "Running" },
    { id: "waiting",  label: "Waiting" },
    { id: "done",     label: "Complete", status: "success" },
  ],
  transitions: [
    { id: "t1", from: "idle", to: "planning" },
    { id: "t2", from: "planning", to: "running" },
    { id: "t3", from: "running", to: "waiting", label: "approval" },
    { id: "t4", from: "waiting", to: "done" },
  ],
  active: "running",
};
machine.addEventListener("agentui:select", (e) => console.log(e.detail.id));
machine.setActive("waiting"); // advance the active state programmatically
```

## When to use SVG vs HTML

| Reach for **SVG** (these components) | Reach for **HTML** |
| --- | --- |
| Graphs, flows, timelines, spatial relationships | Forms, inputs, editable/long text |
| Status/relevance encoded as color, weight, position | Semantic documents, tables, lists |
| Decorative depth (shadows, glow) tied to data | Native controls, accessibility-rich widgets |
| Pannable/zoomable scenes | Scrollable text content |

The components follow this split internally: scenes are SVG, but real controls
(the checkpoint's buttons and note field) are HTML, and you can project HTML into
a component with slots where text or forms belong.

## Limitations

- **Forms and long text in SVG are painful.** These components keep text short
  (labels are truncated) and delegate real input to HTML overlays/slots. Don't
  try to embed a form inside the canvas — emit an event and render HTML beside it.
- **Accessibility has a ceiling.** Interactive parts are keyboard-reachable,
  labelled, and operable with `Enter`/`Space`, and expose `aria-selected`. But
  screen-reader narration of a spatial graph is inherently limited — for critical
  flows, pair a visual component with a textual summary. SVG element focusability
  also varies across browsers.
- **No DOM measurement.** Layout is computed from your data, not from rendered
  geometry, so labels are budgeted by character count rather than measured width.
  This keeps rendering deterministic (and test-friendly) but means very long
  labels truncate rather than wrap.
- **Whole-subtree rendering.** A data change rebuilds the scene. That's ideal for
  the tens-of-nodes scenes these target; for thousands of nodes you'd want a
  virtualized renderer instead.

## Theming

Override CSS custom properties on (or above) any component:

```css
:root { --agentui-accent: #0ea5e9; --agentui-radius: 14px; }
agentui-memory-map { --agentui-bg: #0b1020; --agentui-fg: #e5e7eb; }
```

## Registration & tree-shaking

Importing the package gives you classes and types but does **not** register
elements, so unused components tree-shake away:

```js
import { WorkflowCanvas, registerAll } from "@kibadist/agentui-svg";
registerAll();                                      // all tags, idempotent
customElements.define("my-canvas", WorkflowCanvas); // or one under your own tag
```

## Related

- [Architecture & API contract](https://github.com/kibadist/agentui/blob/main/packages/svg/ARCHITECTURE.md)
- [Concepts](../../concepts/)
