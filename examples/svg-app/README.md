# SVG example — frontend (`svg-app`)

An **agent-observability** demo UI. A Next.js App Router app that renders the
[`@kibadist/agentui-svg`](../../packages/svg) SVG Web Components — workflow
canvases, tool timelines, state machines, memory maps, and approval gates —
driven by an agent over SSE, with quick-action buttons. It pairs with the
[`svg-api`](../svg-api) backend (`:3003`), which owns the recorded runs and the
agent loop.

## Run

```bash
pnpm install                 # at the repo root
pnpm build                   # build all workspace packages first
pnpm --filter @kibadist/agentui-example-svg-app dev   # starts svg-app on :3002
# (run the svg-api on :3003 alongside it)
# open http://localhost:3002
```

The API base defaults to `http://localhost:3003`; override with
`NEXT_PUBLIC_API_URL`. If the backend is down you'll see a connection-error
screen.

## What's inside

- `app/page.tsx` — creates a session on mount, then wires `useAgentStream` →
  `AgentStateProvider`/`AgentActionProvider` → `AgentRenderer` (renders nodes) +
  `ToastList`. `ChatInput` and `QuickActions` send `chat.send` actions;
  `AgentDevTools` is mounted (top-right, collapsed).
- `components/svg-element.tsx` — a generic React host for an SVG Web Component.
  The custom elements `extend HTMLElement` (undefined during SSR), so it
  registers them **client-side only** via a dynamic `import("@kibadist/agentui-svg/register")`
  inside an effect, sets the component's `.data` property, and bridges custom
  events to React callbacks.
- `components/registry.ts` — the **security boundary**: `createRegistry` maps
  the whitelisted component types (`workflow-canvas`, `tool-timeline`,
  `state-machine`, `memory-map`, `review-checkpoint`, `text-block`) to React
  views + Zod prop schemas. Only registered types render.
- `components/views.tsx` — thin views: five wrap a sized `<SvgElement>` and send
  `agent.inspect` / `agent.decision` actions back via `useAgentAction`;
  `text-block` is plain React.

The component types and prop shapes mirror the backend's `COMPONENT_DEFS` in
`svg-api` — keep the two in sync.
