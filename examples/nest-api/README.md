# nest-api

NestJS backend wired to a **real Anthropic agent**. This is the "split backend" half of the full-stack demo — pair it with [`next-app`](../next-app) (`:3000`) for the frontend.

If `ANTHROPIC_API_KEY` is unset, the agent falls back to deterministic mock UI events, so you can run the whole flow with no API key.

## Run

```bash
pnpm install            # at the repo root
pnpm build              # builds all workspace packages
pnpm --filter @kibadist/agentui-example-nest-api dev
# listening on http://localhost:3001
```

To use a real LLM, create `examples/nest-api/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The `dev` script loads it via `node --env-file=.env`. Without it you'll see a `ANTHROPIC_API_KEY not set – agent will return mock UI events` warning and still get a working stream.

## Endpoints

The controller is built from `@kibadist/agentui-nest`'s `createAgentController`:

- `POST /agent/session` → `{ sessionId }`
- `GET  /agent/:sessionId/stream` → SSE stream of UIEvents (`@Sse`)
- `POST /agent/:sessionId/action` → submit an `ActionEvent`

## Smoke test

With the server running, in another terminal:

```bash
./test-client.sh
```

It creates a session, opens the SSE stream for 5s, and submits a `chat.send` action so you can watch UIEvents arrive.

## What's inside

- `src/main.ts` — Nest bootstrap, CORS enabled, reads `PORT` (default 3001).
- `src/agent/agent.controller.ts` — thin wrapper over `createAgentController`; logs session/stream lifecycle.
- `src/agent/agent.service.ts` — the interesting part:
  - `COMPONENT_DEFS` — Zod schemas for the five allowed component types (single source of truth for types **and** props). `describeComponents` turns them into the system prompt.
  - `handleSessionCreated` — emits a welcome `ui.toast` on connect.
  - `handleAction` — runs `runAgentLoop` (from `@kibadist/agentui-ai`) with the allowed types; emits each UIEvent through `AgentSessionService`.
  - `emitMockResponse` — the no-API-key fallback (echo `text-block` + sample `data-table`).

## Swapping the model

`agent.service.ts` constructs the model with `createAnthropic({ apiKey })("claude-sonnet-4-6")`. Because `runAgentLoop` is provider-agnostic (Vercel AI SDK), point it at any AI-SDK `LanguageModel` to switch providers.
