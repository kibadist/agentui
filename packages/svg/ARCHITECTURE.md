# AgentUI SVG — Architecture & Public API

`@kibadist/agentui-svg` is a **zero-dependency, framework-agnostic** set of
SVG-native [Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components)
for making agent behavior visible, interactive, and controllable. It complements
the React-based `@kibadist/agentui-*` packages but shares none of their runtime —
the components are custom elements you can drop into any page, React, Vue, Svelte,
or plain HTML.

This document is the authoritative design contract: package structure, element
naming, the rendering model, data input, the event contract, styling/theming,
and the accessibility baseline, with public-API examples for all five components.

## Package structure

```
packages/svg/
├── src/
│   ├── index.ts                 # public entry — classes, types, foundation (no registration)
│   ├── register.ts              # side-effecting: customElements.define() for every tag
│   ├── types.ts                 # declarative data shapes (the data contract)
│   ├── base/                    # shared foundation
│   │   ├── element.ts           # AgentUIElement base class (shadow DOM, render loop, delegation)
│   │   ├── events.ts            # event names + typed detail payloads + makeEvent()
│   │   ├── a11y.ts              # makeInteractive(), keyboard activation helpers
│   │   ├── dom.ts               # svg()/html() builders, path + truncate helpers
│   │   ├── scene.ts             # createScene() — <svg> + <defs> + viewport <g>
│   │   └── define.ts            # idempotent defineElement()
│   ├── styles/
│   │   ├── tokens.ts            # CSS custom properties + base stylesheet
│   │   └── defs.ts              # reusable SVG <filter> defs (shadow, glow, blur)
│   └── components/
│       ├── workflow-canvas.ts   # <agentui-workflow-canvas>
│       ├── tool-timeline.ts     # <agentui-tool-timeline>
│       ├── review-checkpoint.ts # <agentui-review-checkpoint>
│       ├── memory-map.ts        # <agentui-memory-map>
│       └── state-machine.ts     # <agentui-state-machine>
└── test/                        # vitest + jsdom, one file per component
```

Built with `tsc` to ESM + `.d.ts` in `dist/`, like every other package. Relative
imports carry the `.js` extension (Node ESM), strict TypeScript, target ES2022.

## Custom element naming

All tags are prefixed `agentui-` (a valid, collision-resistant custom-element
prefix) and named for what they show:

| Tag | Class | Purpose |
| --- | --- | --- |
| `agentui-workflow-canvas` | `WorkflowCanvas` | Node/edge graph of an agent flow |
| `agentui-tool-timeline` | `ToolTimeline` | Ordered tool-call run with status/duration |
| `agentui-review-checkpoint` | `ReviewCheckpoint` | Human approval gate |
| `agentui-memory-map` | `MemoryMap` | Context/memory graph feeding an output |
| `agentui-state-machine` | `StateMachine` | Current flow state + transitions |

Registration is **opt-in and separate** from import so bundlers can tree-shake
unused components:

```js
// Register every tag (side effect):
import "@kibadist/agentui-svg/register";

// …or register explicitly / selectively:
import { registerAll } from "@kibadist/agentui-svg";
registerAll();

// …or define a single one under your own tag:
import { WorkflowCanvas } from "@kibadist/agentui-svg";
customElements.define("my-canvas", WorkflowCanvas);
```

## Rendering model

* Each component extends **`AgentUIElement`**, which attaches an **open shadow
  root**. Shadow DOM scopes styles and, crucially, scopes SVG `url(#id)`
  references (filters/gradients) so multiple instances never clash.
* Complex components own **one internal `<svg>` root** built by `createScene()`,
  which injects the shared `<defs>` and a `viewport` `<g>` that pan/zoom
  transforms. Simpler components (the checkpoint) render mostly HTML for real
  text/buttons, with SVG used for the status emblem.
* Rendering is **imperative and whole-subtree**: on a data change the component
  rebuilds its scene. For the scene sizes these components target (tens of
  nodes) this is fast and keeps the code free of a virtual DOM. Selection-only
  changes patch `aria-selected` in place rather than re-rendering.
* Renders are **coalesced** to a microtask, so setting several properties in a
  row triggers exactly one render. `renderNow()` forces a synchronous render
  (used in tests).
* **No DOM measurement.** Layout is computed from data, never from
  `getBBox()`/`getComputedTextLength()` (which are unimplemented under jsdom and
  cause reflow in the browser). Text is truncated by character budget.

## Data input patterns

Primary input is a **JS property**, `.data`, typed per component:

```js
const el = document.createElement("agentui-tool-timeline");
el.data = { items: [{ id: "1", label: "search", status: "success", durationMs: 820 }] };
```

For fully declarative HTML, a **`data` attribute** holding the same shape as JSON
is parsed (fail-closed — malformed JSON is ignored, never throws):

```html
<agentui-review-checkpoint
  data='{"title":"Deploy to production?","level":"high"}'>
</agentui-review-checkpoint>
```

Small, frequently-toggled config uses plain attributes where it makes sense
(e.g. `density="compact"` on the timeline, `layout="radial"` on the state
machine). Attribute changes re-render.

## Event contract

Components communicate **out** via namespaced `CustomEvent`s that **bubble** and
are **composed** (cross the shadow boundary), so a single listener on the host —
or any ancestor — receives them. `detail` is always a plain, serializable object.

| Event | Detail | Emitted by |
| --- | --- | --- |
| `agentui:select` | `{ id, kind, data }` | canvas, timeline, memory-map, state-machine |
| `agentui:action` | `{ action, id?, data? }` | canvas (e.g. background `"clear"`) |
| `agentui:decision` | `{ action, note? }` | review-checkpoint |
| `agentui:edit` | `{ id, data }` | memory-map |
| `agentui:remove` | `{ id, data }` | memory-map |

`kind` is one of `node | edge | item | state | transition | link | checkpoint`.
All events are `cancelable`; calling `preventDefault()` is reserved for future
opt-out semantics and is currently advisory.

```js
canvas.addEventListener("agentui:select", (e) => {
  const { id, kind, data } = e.detail; // e.target is the <agentui-*> element
});
```

### Interaction & event delegation

`AgentUIElement` installs exactly **one** `click` and **one** `keydown` listener
on the shadow root (event delegation), regardless of how many interactive parts
the scene has. Any element marked `data-activate` (added by `makeInteractive()`)
is recognised; the base resolves the activation target with `closest()` and calls
the subclass's `onActivate(el, event)`. This keeps listener count O(1) for scenes
with hundreds of nodes.

## Styling & theming strategy

* **Theme via CSS custom properties** on `--agentui-*` (surfaces, accent, a full
  status palette, geometry, typography, focus/selection). Because custom
  properties inherit through the shadow boundary, one rule on an ancestor themes
  every instance:

  ```css
  :root { --agentui-accent: #0ea5e9; --agentui-radius: 14px; }
  agentui-memory-map { --agentui-bg: #0b1020; --agentui-fg: #e5e7eb; }
  ```

* **Status tokens**: `--agentui-status-{idle,planning,running,waiting,success,
  failed,skipped,blocked}` drive node/edge/state colors via a `--status` local
  variable set by `status-*` classes.
* **SVG vs CSS filters** (documented in `styles/defs.ts`): reusable SVG
  `<filter>`s provide node elevation (`soft-shadow`) and the active-node `glow`
  (blur + flood + composite + merge — not expressible as a single CSS filter and
  reusable across many nodes via `filter="url(#…)"`). One-off HTML overlays use
  CSS `box-shadow`/`drop-shadow`. Rule of thumb: **SVG filters for reusable,
  per-node, compositing effects; CSS filters for simple one-element shadows.**
* `::part(scene)` is exposed on the render container for coarse external layout
  hooks.

## Accessibility baseline

SVG has weak built-in semantics, so interactivity is made explicit and uniform:

* Interactive parts get `tabindex="0"`, a `role` (`button`/`option`), and an
  `aria-label` (SVG shapes have no implicit name) via `makeInteractive()`.
* **Keyboard activation**: `Enter` and `Space` activate the focused part through
  the same delegated handler as pointer clicks; `Space` default-scroll and
  `Enter` form-submit are prevented.
* Selection state is exposed as `aria-selected`; disabled affordances set
  `aria-disabled="true"` and are skipped by activation.
* Focus is shown with a high-contrast `:focus-visible` outline (`--agentui-focus-ring`).
* The `<svg>` scene carries a `role` and `aria-label`; decorative sub-shapes are
  not individually focusable.

**Caveats** (also in the docs): focusability of SVG elements varies by browser;
for forms and long editable text, components emit events for an HTML overlay
rather than embedding inputs in SVG; screen-reader narration of spatial graphs is
inherently limited — pair visual components with a textual summary for critical
flows.

## Public API examples

```js
import "@kibadist/agentui-svg/register";

// 1. Workflow canvas — planner → tool → memory → response
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
canvas.addEventListener("agentui:select", (e) => console.log(e.detail));

// 2. Tool call timeline
const timeline = document.createElement("agentui-tool-timeline");
timeline.setAttribute("density", "expanded");
timeline.data = { items: [
  { id: "1", label: "plan", status: "success", durationMs: 120 },
  { id: "2", label: "web.search", status: "success", durationMs: 820, detail: "3 results" },
  { id: "3", label: "db.query", status: "failed", durationMs: 40 },
] };

// 3. Review checkpoint (human approval gate)
const gate = document.createElement("agentui-review-checkpoint");
gate.data = {
  title: "Send 1,204 emails?",
  description: "Campaign will send immediately and cannot be recalled.",
  level: "high",
  summary: "1,204 recipients · template: launch-v2",
};
gate.addEventListener("agentui:decision", (e) => console.log(e.detail.action, e.detail.note));

// 4. Memory map
const memory = document.createElement("agentui-memory-map");
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

// 5. State machine viewer
const machine = document.createElement("agentui-state-machine");
machine.setAttribute("layout", "horizontal");
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
```
