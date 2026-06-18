# Clinic example — backend (`nest-api`)

The AgentUI reference example: a **clinic assistant** where an LLM agent answers questions about patients, vitals, medications, and appointments by querying a real **SQLite** database, then renders the results as typed healthcare UI components.

This package is the backend half. The UI lives in [`next-app`](../next-app). Run both together.

## Run the full example

```bash
pnpm install                 # at the repo root
pnpm build                   # build all workspace packages first
pnpm dev                     # starts nest-api (:3001) + next-app (:3000)
# open http://localhost:3000
```

`pnpm dev` runs both halves (it builds first, too). To run just the backend: `pnpm --filter @kibadist/agentui-example-nest-api dev`.

### Optional: real LLM

With no key, the agent serves **DB-backed mock responses** and is fully usable. To use a real Anthropic model, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`:

```bash
cp examples/nest-api/.env.example examples/nest-api/.env
# edit it, then restart
```

The dev script loads `.env` only if present (`--env-file-if-exists`), so no file is required to run.

## The database

`src/db/clinic-db.ts` is an **in-memory SQLite DB** (via `better-sqlite3`), seeded fresh on boot with **5 patients** plus their vitals, medications, and appointments. Appointment/vitals dates are anchored to the server's current date, so "today's appointments" always returns something. Nothing persists — restart for a clean slate.

| Table | Notes |
|-------|-------|
| `patients` | 5 seeded patients (MRN-1001 … MRN-1005), demographics + primary condition |
| `vitals` | latest reading per patient; two patients are intentionally out of range |
| `medications` | 1–2 active meds per patient |
| `appointments` | spread across this week + one past visit |

Query methods: `listPatients`, `getPatient(mrn)`, `searchPatients({condition,status})`, `getAppointments(when)`, `patientsWithAbnormalVitals()`.

## The agent

`src/agent/agent.service.ts`:

- **Read-only DB tools** (`src/db/clinic-tools.ts`) are passed to `runAgentLoop` as `extraTools`: `list_patients`, `get_patient`, `search_patients`, `get_appointments`, `abnormal_vitals`. The agent calls these to fetch real data, then emits UI with `emit_ui_event`.
- **Allowed component types** are defined once as Zod schemas (`COMPONENT_DEFS`) and turned into the system prompt via `describeComponents`. They mirror the frontend registry in `next-app/components/schemas.ts` — keep the two in sync.
- **Mock fallback** (no API key) keyword-routes the message to a DB query and emits the matching components, so the demo works offline.
- **Drill-in:** a clicked `patient-list` row sends a `patient.view` action carrying the MRN; the service renders that patient's card + vitals + medications.

## Endpoints

Built from `@kibadist/agentui-nest`'s `createAgentController`:

- `POST /agent/session` → `{ sessionId }`
- `GET  /agent/:sessionId/stream` → SSE stream of UIEvents
- `POST /agent/:sessionId/action` → submit an `ActionEvent`

## Smoke test

With the server running, in another terminal:

```bash
./test-client.sh                       # default: "List all patients"
./test-client.sh "Today's appointments"
```

It creates a session, opens the SSE stream, submits the prompt, and prints the emitted UIEvents.
