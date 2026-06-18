# Agent-observability example — backend (`svg-api`)

An AgentUI example where a **real LLM agent investigates an incident** and the typed
SVG components (`@kibadist/agentui-svg`) render its **actual execution, live**. The
agent runs real tool calls over a **SQLite** fleet database; each call streams into
a workflow graph, a tool timeline, a state machine, and a memory map, with a review
checkpoint when it proposes a rollback.

Nothing is canned — the components reflect the agent's genuine tool calls (real
names, real durations, real results). This package is the backend half; it speaks
the same SSE + action protocol as the clinic [`nest-api`](../nest-api).

## Requires an Anthropic API key

This example shows a **real instrumented agent run and has no offline mock**. Set a
key before using it:

```bash
cp examples/svg-api/.env.example examples/svg-api/.env
# edit examples/svg-api/.env and set ANTHROPIC_API_KEY=sk-ant-...
```

Without a key the agent renders a "set the key" message instead of fabricating a run.

## Run the backend

```bash
pnpm install                 # at the repo root
pnpm build                   # build all workspace packages first
pnpm --filter @kibadist/agentui-example-svg-api dev   # starts svg-api on :3003
```

(Or `pnpm dev:svg` from the root to run this plus the [`svg-app`](../svg-app) frontend.)

## The database

`src/db/agent-db.ts` is an **in-memory SQLite DB** (via `better-sqlite3`), seeded
fresh on boot with a production fleet: `services`, `deploys` (one recent **bad**
deploy on `checkout-service`), `error_logs` (spiking after it), and `metrics`
(elevated error rate / p99). Timestamps are anchored to now. Nothing persists —
restart for a clean slate.

## How it works

- **Real tools** (`src/db/agent-tools.ts`): `list_services`, `get_deploys`,
  `query_error_logs`, `get_metrics` (read-only) and `propose_rollback` (the write
  action — it doesn't mutate the DB; it asks for human approval).
- **Instrumented run** (`src/agent/agent.service.ts`): on a user prompt the service
  calls the AI SDK's `generateText` with those tools, **wrapping each tool's
  `execute`** so a per-turn `RunRecorder` observes every real call. No
  `emit_ui_event` — the service emits the components from the instrumentation, not
  the model.
- **Live components** (`src/agent/run-recorder.ts`): after each tool start/finish the
  recorder (re)emits the components with stable keys — first `ui.append`, then
  `ui.replace` (`{ key, props, replace: true }`). The agent's real tool calls become
  the **timeline**; the plan → tools → respond flow becomes the **workflow**; the
  loop phase (planning → investigating → awaiting-approval → resolved) becomes the
  **state machine**; the data it pulled becomes the **memory map**. `propose_rollback`
  emits a **review-checkpoint** built from the real metrics/logs.
- **Actions back**: `agent.decision` (checkpoint continue/stop/revise) toasts and
  advances the state machine; `agent.inspect` (selecting a node/item) renders that
  step's real detail as a text-block.

## Component shapes

The recorder emits these node `type`s, whose props must match the frontend registry
in [`svg-app/components/schemas.ts`](../svg-app/components/schemas.ts):

| Type | Props |
| --- | --- |
| `workflow-canvas` | `{ title?, nodes, edges }` |
| `tool-timeline` | `{ title?, items }` |
| `state-machine` | `{ title?, states, transitions, active }` |
| `memory-map` | `{ title?, nodes, links }` |
| `review-checkpoint` | `{ title, description?, level?, summary? }` |
| `text-block` | `{ title?, body }` |

## Endpoints

Built from `@kibadist/agentui-nest`'s `createAgentController`:

- `POST /agent/session` → `{ sessionId }`
- `GET  /agent/:sessionId/stream` → SSE stream of UIEvents
- `POST /agent/:sessionId/action` → submit an `ActionEvent`

## Tests

`test/instrumentation.test.ts` drives the framework-pure `RunRecorder` directly (no
model needed) and asserts the emitted `ui.append`/`ui.replace` events reflect the
tool order, statuses, and durations. It runs under this package's own
`vitest.config.ts` (not the root suite):

```bash
npx vitest run --config examples/svg-api/vitest.config.ts
```

`test-client.sh` is a curl smoke test (needs a key, since there's no mock run).
