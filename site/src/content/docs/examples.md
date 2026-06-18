---
title: "Example"
description: "A full-featured clinic assistant — an LLM agent that queries a SQLite database and renders typed healthcare UI components."
---

The monorepo ships one full-featured example: a **clinic assistant**. An LLM agent answers questions about patients, vitals, medications, and appointments by querying a real **SQLite** database through read-only tools, then renders the results as typed healthcare components. User interactions — like clicking a patient row — come back as actions and drive the next render.

It's split across two workspace packages (neither is published):

| Package | Port | Role |
|---------|------|------|
| [`nest-api`](https://github.com/kibadist/agentui/tree/main/examples/nest-api) | 3001 | NestJS backend: SQLite database, agent loop, DB query tools |
| [`next-app`](https://github.com/kibadist/agentui/tree/main/examples/next-app) | 3000 | Next.js frontend: healthcare component registry, suggestion chips |

## Run it

```bash
pnpm install          # at the repo root
pnpm build            # build all workspace packages first
pnpm dev              # runs nest-api (:3001) + next-app (:3000)
```

Open [http://localhost:3000](http://localhost:3000) and try a suggestion chip, or ask something like *"Which patients have abnormal vitals?"*

**No API key needed.** Without `ANTHROPIC_API_KEY` the backend serves DB-backed mock responses and is fully usable. To use a real model, copy `examples/nest-api/.env.example` to `.env` and set your key.

## The database

`nest-api/src/db/clinic-db.ts` seeds an **in-memory SQLite database** (via `better-sqlite3`) on boot with **five patients** plus their vitals, medications, and appointments. Appointment and vitals dates are anchored to the current date, so date filters like "today's appointments" always return something. Two patients have intentionally out-of-range vitals. Nothing persists — restarting gives a clean slate.

## The agent

The agent gets **read-only database tools** — `list_patients`, `get_patient`, `search_patients`, `get_appointments`, `abnormal_vitals` — passed to `runAgentLoop` as `extraTools` (see [LLM adapters](/agentui/guides/llm-adapters)). It calls them to fetch real data, never inventing patients, then renders with `emit_ui_event`. The allowed component types are declared once as Zod schemas and injected into the system prompt with `describeComponents`.

## The components

The frontend registers a healthcare-specific [registry](/agentui/guides/renderer) — the security boundary that decides what the agent may render:

- **`patient-list`** — clickable roster; a row click sends a `patient.view` action carrying the MRN, which drills into that patient.
- **`patient-card`** — one patient's demographics and status.
- **`vitals-panel`** — latest vitals, flagging out-of-range values itself (a client-side copy of the reference ranges) so the agent only sends raw numbers.
- **`medication-list`**, **`appointment-list`** — tabular clinical records.
- **`text-block`** — natural-language summaries.

DB-related **suggestion chips** above the input ("List all patients", "Today's appointments", "Patients with abnormal vitals", …) send starter prompts. The full client wiring — `useAgentStream`, `AgentRenderer`, action/state providers, `AgentDevTools` — lives in `next-app/app/page.tsx`.
