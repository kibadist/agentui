# Agent-observability example — backend (`svg-api`)

An AgentUI example where an LLM agent turns **recorded agent runs** into a live observability dashboard built from the typed SVG components (`@kibadist/agentui-svg`). The agent queries a real **SQLite** database of runs, then renders each one as a workflow graph, a tool timeline, a state machine, a memory map, and an optional review checkpoint.

This package is the backend half. It speaks the same SSE + action protocol as the clinic [`nest-api`](../nest-api).

## Run the backend

```bash
pnpm install                 # at the repo root
pnpm build                   # build all workspace packages first
pnpm --filter @kibadist/agentui-example-svg-api dev   # starts svg-api on :3003
```

### Optional: real LLM

With no key, the agent serves **DB-backed mock responses** and is fully usable. To use a real Anthropic model, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`:

```bash
cp examples/svg-api/.env.example examples/svg-api/.env
# edit it, then restart
```

The dev script loads `.env` only if present (`--env-file-if-exists`), so no file is required to run.

## The database

`src/db/agent-db.ts` is an **in-memory SQLite DB** (via `better-sqlite3`), seeded fresh on boot with **3 recorded runs**. Nothing persists — restart for a clean slate.

| Run slug | Task |
|----------|------|
| `deploy-investigation` | Investigate the failing production deploy (has a high-level review checkpoint) |
| `intake-summary` | Summarize the new patient intake |
| `competitor-research` | Research competitor pricing tiers |

Each run carries steps (workflow nodes + timeline items), edges (with branch/merge), memory items (one `output` node the rest link to), and a state machine with an active state.

Query methods: `listRuns()`, `getRun(slug)`, `stepDetail(slug, stepKey)`, `memoryDetail(slug, memKey)`.

## The agent

`src/agent/agent.service.ts`:

- **Read-only DB tools** (`src/db/agent-tools.ts`) are passed to `runAgentLoop` as `extraTools`: `list_runs`, `get_run`. The agent calls these to fetch a run, then emits UI with `emit_ui_event`.
- **Allowed component types** are defined once as Zod schemas (`COMPONENT_DEFS`) and turned into the system prompt via `describeComponents`. They mirror the frontend SVG registry — keep the two in sync. The vocabulary is `workflow-canvas`, `tool-timeline`, `state-machine`, `memory-map`, `review-checkpoint`, and `text-block`.
- **Mock fallback** (no API key) keyword-routes the message to a run and emits every matching component, so the demo works offline.
- **Inspect:** an `agent.inspect` action (`{ kind, id, slug }`) renders a `text-block` with the step/memory detail.
- **Decision:** an `agent.decision` action from a `review-checkpoint` is acknowledged with a `ui.toast`.

## Endpoints

Built from `@kibadist/agentui-nest`'s `createAgentController`:

- `POST /agent/session` → `{ sessionId }`
- `GET  /agent/:sessionId/stream` → SSE stream of UIEvents
- `POST /agent/:sessionId/action` → submit an `ActionEvent`

## Smoke test

With the server running, in another terminal:

```bash
./test-client.sh                              # default: "Visualize the deploy investigation"
./test-client.sh "Show the competitor research run"
```

It creates a session, opens the SSE stream, submits the prompt, and prints the emitted UIEvents.
