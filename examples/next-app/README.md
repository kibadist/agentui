# next-app

Next.js App Router frontend with a **custom component registry**. This is the "frontend" half of the full-stack demo — it talks to the [`nest-api`](../nest-api) backend (`:3001`) over SSE + action POSTs.

## Run

Start the backend first (see [`nest-api`](../nest-api)), then:

```bash
pnpm install            # at the repo root
pnpm build              # builds all workspace packages
pnpm --filter @kibadist/agentui-example-next-app dev
# open http://localhost:3000
```

The API base defaults to `http://localhost:3001`; override with `NEXT_PUBLIC_API_URL` if the backend runs elsewhere. If the backend is down you'll see a "Connection error" screen pointing at the expected URL.

## What's inside

- `app/page.tsx` — creates a session on mount (`POST /agent/session`), then renders `AgentSession`:
  - `useAgentStream({ url, sessionId })` → `{ state, status, store }` (SSE-backed).
  - `AgentStateProvider` + `AgentActionProvider` wrap the tree so components can read state and send actions.
  - `AgentRenderer` renders `state.nodes` through the registry; `ToastList` renders `state.toasts`.
  - `ChatInput` submits `chat.send` `ActionEvent`s; a header badge reflects connection `status`.
  - `AgentDevTools` (from `@kibadist/agentui-react/devtools`) is mounted for live inspection.
- `components/registry.ts` — the **security boundary**: `createRegistry({...})` maps five whitelisted types to React components + Zod prop schemas.
- `components/*.tsx` — the components themselves (`text-block`, `info-card`, `action-card`, `data-table`, `status-badge`) and their `schemas.ts`.

These five types mirror the `COMPONENT_DEFS` the `nest-api` agent is allowed to emit — the registry is what enforces that only registered types render.

## Customizing

Add a component by writing it + its prop schema, then registering it in `components/registry.ts`. To render the new type, the backend agent must also be allowed to emit it (see `nest-api`'s `COMPONENT_DEFS`).
