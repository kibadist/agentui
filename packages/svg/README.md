# @kibadist/agentui-svg

SVG-native [Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components)
for making agent behavior **visible, interactive, and controllable** — workflows,
tool-call timelines, human approval gates, memory maps, and state machines.

Zero runtime dependencies. Framework-agnostic custom elements: use them in plain
HTML, React, Vue, Svelte, or anywhere the DOM exists. Part of the
[AgentUI](https://github.com/kibadist/agentui) family but sharing none of its
runtime — drop these in next to your existing UI.

```bash
npm i @kibadist/agentui-svg
```

## Quick start

```js
import "@kibadist/agentui-svg/register"; // registers all <agentui-*> elements

const canvas = document.createElement("agentui-workflow-canvas");
canvas.data = {
  nodes: [
    { id: "plan", label: "Planner", status: "success" },
    { id: "tool", label: "Search", sublabel: "web.search", status: "running" },
    { id: "resp", label: "Response", status: "waiting" },
  ],
  edges: [
    { id: "e1", from: "plan", to: "tool" },
    { id: "e2", from: "tool", to: "resp" },
  ],
};
canvas.addEventListener("agentui:select", (e) => console.log(e.detail)); // { id, kind, data }
document.body.append(canvas);
```

Or fully declaratively in HTML:

```html
<script type="module">
  import "@kibadist/agentui-svg/register";
</script>

<agentui-review-checkpoint
  data='{"title":"Deploy to production?","level":"high","summary":"v2.4.1 · 3 services"}'>
</agentui-review-checkpoint>
```

## Demo

A self-contained demo page renders all five components in one realistic agent run,
with live cross-component selection and an event log. Build the package, then
serve the folder:

```bash
pnpm --filter @kibadist/agentui-svg build
npx serve packages/svg            # then open /demo/index.html
# or: python3 -m http.server -d packages/svg 8731  →  http://localhost:8731/demo/
```

See [`demo/`](./demo/index.html). Edit [`demo/fixtures.js`](./demo/fixtures.js) to
change the sample data.

## Components

| Tag | What it shows |
| --- | --- |
| `agentui-workflow-canvas` | Node/edge graph of an agent flow, with pan/zoom + selection |
| `agentui-tool-timeline` | Ordered tool-call run with status, duration, and detail |
| `agentui-review-checkpoint` | Human approval gate — continue / stop / revise, with an optional note |
| `agentui-memory-map` | Context/memory graph (preferences, sources, rules) feeding an output |
| `agentui-state-machine` | Current flow state + transitions, horizontal or radial |

## Why SVG?

Agent products aren't simple CRUD screens — they need spatial interfaces for
flows, tool calls, memory/context, state transitions, and approval checkpoints.
SVG gives scalable, styleable, hit-testable vector scenes; HTML is kept available
(via overlays/slots) wherever real forms and long text belong. See
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design contract and the
[docs site](https://kibadist.github.io/agentui/) for guides.

## Registration & tree-shaking

Importing the package entry gives you the classes and types but does **not**
register custom elements, so unused components tree-shake away:

```js
import { WorkflowCanvas, registerAll } from "@kibadist/agentui-svg";

registerAll();                                   // register everything, or…
customElements.define("my-canvas", WorkflowCanvas); // register one under your own tag
```

`import "@kibadist/agentui-svg/register"` is the convenient side-effecting entry
that registers all tags (idempotently).

## Events

Every component emits bubbling, composed `CustomEvent`s, so one listener on the
host (or any ancestor) receives them. `detail` is always plain and serializable.

| Event | Detail | From |
| --- | --- | --- |
| `agentui:select` | `{ id, kind, data }` | canvas, timeline, memory-map, state-machine |
| `agentui:action` | `{ action, id?, data? }` | canvas |
| `agentui:decision` | `{ action, note? }` | review-checkpoint |
| `agentui:edit` / `agentui:remove` | `{ id, data }` | memory-map |

## Theming

Override CSS custom properties at any level above (or on) a component:

```css
:root {
  --agentui-accent: #0ea5e9;
  --agentui-radius: 14px;
}
agentui-memory-map {
  --agentui-bg: #0b1020;
  --agentui-fg: #e5e7eb;
}
```

All tokens are listed in [`ARCHITECTURE.md`](./ARCHITECTURE.md#styling--theming-strategy).

## Accessibility

Interactive scene parts are keyboard-reachable (`Tab`), operable with
`Enter`/`Space`, labelled with `aria-label`, and expose `aria-selected`. Focus is
shown with a high-contrast ring. SVG accessibility has limits — see the
[accessibility baseline](./ARCHITECTURE.md#accessibility-baseline) for caveats and
guidance on pairing spatial components with textual summaries.

## License

MIT
