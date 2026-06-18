# Clinic example — frontend (`next-app`)

The UI for the AgentUI clinic assistant. A Next.js App Router app that renders the agent's healthcare components and sends user actions back over SSE. It pairs with the [`nest-api`](../nest-api) backend (`:3001`), which owns the SQLite database and the agent loop.

## Run

```bash
pnpm install                 # at the repo root
pnpm build                   # build all workspace packages first
pnpm dev                     # starts nest-api (:3001) + next-app (:3000)
# open http://localhost:3000
```

`pnpm dev` runs both halves. The API base defaults to `http://localhost:3001`; override with `NEXT_PUBLIC_API_URL`. If the backend is down you'll see a connection-error screen.

## What's inside

- `app/page.tsx` — creates a session on mount, then wires `useAgentStream` → `AgentStateProvider`/`AgentActionProvider` → `AgentRenderer` (renders nodes) + `ToastList`. `ChatInput` and `SuggestionChips` send `chat.send` actions; `AgentDevTools` is mounted (top-right, collapsed).
- `components/suggestion-chips.tsx` — DB-related starter prompts ("List all patients", "Today's appointments", "Patients with abnormal vitals", …).
- `components/registry.ts` — the **security boundary**: `createRegistry` maps the whitelisted healthcare component types to React components + Zod prop schemas. Only registered types render.
- Healthcare components:
  - `patient-list` — clickable roster; a row click sends a `patient.view` action (MRN) to drill in.
  - `patient-card` — one patient's demographics + status.
  - `vitals-panel` — latest vitals; **flags out-of-range values itself** using a client-side copy of the reference ranges (mirrors the backend), so the agent only sends raw numbers.
  - `medication-list`, `appointment-list` — tabular records.
  - `text-block` — natural-language summaries.

The component types and prop shapes mirror the backend's `COMPONENT_DEFS` in `nest-api/src/agent/agent.service.ts` — keep the two in sync.

## Customizing

Add a component by writing it + its prop schema in `components/`, then registering it in `components/registry.ts`. For the agent to emit the new type, also add it to the backend's `COMPONENT_DEFS`.
